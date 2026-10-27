/**
 * 抓取台湾省各县市（及代表景点）的中文维基百科条目，落到本地缓存。
 *
 * 与 `fetch-wiki-content.mjs` 同一套原则与限流（串行 + 1.4s 间隔），
 * 只是范围限定在台湾省：DataV 没有台湾的区县边界源，之前的补全管线
 * 从来没覆盖到这儿，所以单独跑一次。
 *
 * 产物：scripts/.cache/wiki-tw/<key>.json
 *   { key, title, extract, coords: [lng, lat] | null, sections: { 历史: '…', … } }
 *
 * 运行：node scripts/fetch-taiwan-wiki.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CACHE = join(ROOT, 'scripts/.cache/wiki-tw');
const UA = 'shanhe-chengyi/0.9 (district content enrichment; local dev)';
const API = 'https://zh.wikipedia.org/w/api.php';
const GAP_MS = 2200;
const BATCH = 20;

mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 台湾省 20 个县市（与 gen-taiwan-geo.mjs 的编码一致） */
const COUNTIES = [
  ['710001', '台北市'],
  ['710002', '新北市'],
  ['710003', '桃园市'],
  ['710004', '台中市'],
  ['710005', '台南市'],
  ['710006', '高雄市'],
  ['710007', '基隆市'],
  ['710008', '新竹市'],
  ['710009', '新竹县'],
  ['710010', '苗栗县'],
  ['710011', '彰化县'],
  ['710012', '南投县'],
  ['710013', '云林县'],
  ['710014', '嘉义县'],
  ['710015', '嘉义市'],
  ['710016', '屏东县'],
  ['710017', '宜兰县'],
  ['710018', '花莲县'],
  ['710019', '台东县'],
  ['710020', '澎湖县'],
];

/**
 * 代表景点。
 *
 * 标题一律写**维基上的实际条目名（多为繁体）**——中文维基对这些条目没有简→繁重定向，
 * 写简体直接查不到（实测「太鲁阁国家公园」无正文，「太魯閣國家公園」才有）。
 * 名字本身是公开常识，但**坐标一律从维基取，绝不手写**，并会用 TAIWAN_BBOX 校验，
 * 防止搜索/重定向把条目串到省外（曾出现「十七公里海岸风景区」被配到山东的情况）。
 */
const SPOTS = [
  ['tp-101', '台北101', '710001'],
  ['tp-gugong', '國立故宮博物院', '710001'],
  ['tp-beitou', '北投溫泉', '710001'],
  ['tp-yangming', '陽明山國家公園', '710001'],
  ['nt-jiufen', '九份', '710002'],
  ['nt-wulai', '烏來區', '710002'],
  ['nt-tamsui', '淡水區', '710002'],
  ['ty-daxi', '大溪老街', '710003'],
  ['ty-lala', '拉拉山', '710003'],
  ['tc-fengjia', '逢甲夜市', '710004'],
  ['tc-sunmoon', '日月潭', '710012'],
  ['tn-chikan', '赤崁樓', '710005'],
  ['tn-anping', '安平古堡', '710005'],
  ['kh-xiziwan', '西子灣', '710006'],
  ['kh-liuhe', '六合夜市', '710006'],
  ['kl-miaokou', '基隆廟口', '710007'],
  ['hc-chenghuang', '新竹都城隍廟', '710008'],
  ['ml-feiniu', '飛牛牧場', '710010'],
  ['ch-lugang', '鹿港鎮', '710011'],
  ['ch-bagua', '八卦山', '710011'],
  ['nt-alishan', '阿里山國家森林遊樂區', '710014'],
  ['cy-fenqihu', '奮起湖', '710014'],
  ['cy-railway', '阿里山森林鐵路', '710014'],
  ['pt-kenting', '墾丁國家公園', '710016'],
  ['il-luodong', '羅東夜市', '710017'],
  ['il-jiaoxi', '礁溪溫泉', '710017'],
  ['hl-taroko', '太魯閣國家公園', '710018'],
  ['hl-qixingtan', '七星潭', '710018'],
  ['tt-greenisland', '綠島', '710019'],
  ['ph-shuangxinyuan', '雙心石滬', '710020'],
];

/** 台湾省经纬范围，用于校验景点坐标真的在省内 */
const TAIWAN_BBOX = { minLng: 118.5, maxLng: 123.0, minLat: 20.5, maxLat: 26.5 };

const targets = [
  ...COUNTIES.map(([id, name]) => ({ key: `d${id}`, title: name })),
  ...SPOTS.map(([id, name, county]) => ({ key: `s${id}`, title: name, county })),
];

const pending = targets.filter((t) => !existsSync(join(CACHE, `${t.key}.json`)));
console.log(`· 待抓取 ${pending.length} / ${targets.length}（已缓存的跳过）`);

/** wikitext → 纯文本（去模板 / 注释 / 链接语法 / 粗体） */
function toPlain(wikitext) {
  let s = wikitext ?? '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '');
  s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\{\{[\s\S]*?\}\}/g, '');
  s = s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2');
  s = s.replace(/'''?/g, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** 按 `== 标题 ==` 切段 */
function splitSections(text) {
  const out = {};
  const re = /^==+\s*([^=\n]+?)\s*==+\s*$/gm;
  const hits = [...text.matchAll(re)];
  for (let i = 0; i < hits.length; i++) {
    const name = hits[i][1].replace(/[=]/g, '').trim();
    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length;
    out[name] = text.slice(start, end).trim();
  }
  return out;
}

/**
 * 用搜索解析真正的条目名。
 *
 * 台湾的景点条目名多是繁体，而且**简→繁没有自动重定向**
 * （「太鲁阁国家公园」查不到，「太魯閣國家公園」才是条目；
 *  而县市名「台北市」→「臺北市」是有重定向的，两者行为不一致）。
 * 与其手抄一份繁简对照表，不如让维基自己搜。
 */
async function searchTitle(name) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srsearch: name,
    srlimit: '3',
    srnamespace: '0',
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const json = await res.json();
  const hits = json?.query?.search ?? [];
  if (!hits.length) return null;
  // 首选完全同名；否则取第一条（搜索结果按相关度排）
  return hits.find((h) => h.title === name)?.title ?? hits[0].title;
}

/** 把一个页面写进缓存；返回 false 表示没拿到正文，调用方应改走搜索解析 */
function saveTarget(t, p) {
  const wikitext = p?.revisions?.[0]?.slots?.main?.['*'] ?? '';
  if (!wikitext) return false;
  // 消歧义页：正文会是「XX可以指：」，不能拿来做内容
  const plain = toPlain(wikitext);
  const isDisambig = /可以指/.test(plain.slice(0, 200));
  const coords = p?.coordinates?.[0] ? [p.coordinates[0].lon, p.coordinates[0].lat] : null;
  const inTaiwan =
    !coords ||
    (coords[0] >= TAIWAN_BBOX.minLng &&
      coords[0] <= TAIWAN_BBOX.maxLng &&
      coords[1] >= TAIWAN_BBOX.minLat &&
      coords[1] <= TAIWAN_BBOX.maxLat);
  writeFileSync(
    join(CACHE, `${t.key}.json`),
    JSON.stringify(
      {
        key: t.key,
        title: p.title ?? t.title,
        requested: t.title,
        county: t.county ?? null,
        missing: Boolean(p.missing),
        disambig: isDisambig,
        intro: p?.extract ?? '',
        coords,
        inTaiwan,
        sections: splitSections(plain),
      },
      null,
      1,
    ),
  );
  if (!inTaiwan) console.log(`  ! 坐标在台湾范围外，已标记：${t.title} ${coords?.join(',')}`);
  fetched += 1;
  return true;
}

let fetched = 0;
/** 第一遍没拿到正文的，等第二遍用搜索解析标题后重试 */
const needSearch = [];
for (let i = 0; i < pending.length; i += BATCH) {
  const batch = pending.slice(i, i + BATCH);
  const titles = batch.map((b) => b.title).join('|');
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'revisions|coordinates|extracts',
    rvprop: 'content',
    rvslots: 'main',
    titles,
    redirects: '1',
    explaintext: '1',
    exintro: '1',
    // 关键：extracts 的 exlimit 默认是 **1**，批量请求时只有第一个页面会返回摘要，
    // 其余全是空串（实测 18/37 景点 intro 长度为 0）。必须显式放宽。
    exlimit: 'max',
    colimit: 'max',
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    console.error(`  ! HTTP ${res.status}，批次 ${i / BATCH + 1} 跳过`);
    await sleep(GAP_MS * 3);
    continue;
  }
  const json = await res.json();
  const pages = json?.query?.pages ?? {};
  /**
   * 用 API 返回的 redirects / normalized 做**精确**解析，而不是自己猜繁简规则。
   * 中文维基的台湾条目名是繁体，且差异不止「臺→台」：
   * 「苗栗县」→「苗栗縣」、「台东县」→「臺東縣」，靠替换单字根本覆盖不全，
   * 实测因此静默丢掉了 13/20 个县市。
   */
  const alias = new Map();
  for (const r of json?.query?.redirects ?? []) alias.set(r.from, r.to);
  for (const n of json?.query?.normalized ?? []) alias.set(n.from, n.to);
  const byTitle = new Map(Object.values(pages).map((p) => [p.title, p]));

  for (const t of batch) {
    const resolved = alias.get(t.title) ?? t.title;
    const p = byTitle.get(resolved) ?? Object.values(pages).find((x) => x.title === t.title);
    if (!p || !saveTarget(t, p)) needSearch.push(t);
  }
  console.log(`  … ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
  await sleep(GAP_MS);
}

/* ---------- 第二遍：搜索解析繁体条目名后重试 ---------- */
if (needSearch.length > 0) {
  console.log(`· 第二遍：${needSearch.length} 条要先用搜索解析真实条目名`);
  const resolvedPairs = [];
  for (const t of needSearch) {
    let title = await searchTitle(t.title);
    await sleep(GAP_MS);
    if (!title) {
      // 确认找不到：落一条空记录，避免以后每次重跑都再搜一遍
      writeFileSync(
        join(CACHE, `${t.key}.json`),
        JSON.stringify({ key: t.key, requested: t.title, missing: true, intro: '', sections: {} }),
      );
      console.log(`  × ${t.title} 搜不到条目`);
      continue;
    }
    if (title !== t.title) console.log(`  · ${t.title} → ${title}`);
    resolvedPairs.push({ t, title });
  }

  for (let i = 0; i < resolvedPairs.length; i += BATCH) {
    const slice = resolvedPairs.slice(i, i + BATCH);
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'revisions|coordinates|extracts',
      rvprop: 'content',
      rvslots: 'main',
      titles: slice.map((s) => s.title).join('|'),
      redirects: '1',
      explaintext: '1',
      exintro: '1',
      exlimit: 'max',
      colimit: 'max',
    });
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.error(`  ! HTTP ${res.status}，第二遍批次 ${i / BATCH + 1} 跳过`);
      await sleep(GAP_MS * 3);
      continue;
    }
    const json = await res.json();
    const pages = json?.query?.pages ?? {};
    const alias = new Map();
    for (const r of json?.query?.redirects ?? []) alias.set(r.from, r.to);
    for (const n of json?.query?.normalized ?? []) alias.set(n.from, n.to);
    const byTitle = new Map(Object.values(pages).map((p) => [p.title, p]));
    for (const { t, title } of slice) {
      const p = byTitle.get(alias.get(title) ?? title) ?? byTitle.get(title);
      if (!p || !saveTarget(t, p)) {
        writeFileSync(
          join(CACHE, `${t.key}.json`),
          JSON.stringify({ key: t.key, requested: t.title, missing: true, intro: '', sections: {} }),
        );
      }
    }
    await sleep(GAP_MS);
  }
}

console.log(`· 完成：本轮 ${fetched} 条，缓存目录 ${CACHE}`);
