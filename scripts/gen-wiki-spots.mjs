/**
 * 从已缓存的维基条目里，批量提取全国区县的景点，生成 `scripts/content/wiki-spots.mjs`。
 *
 * 背景：全国 2860 个区县里只有 796 个有景点。而 `scripts/.cache/wiki/` 已经躺着
 * 2519 个区县的原始 wikitext（fetch-wiki-content.mjs 抓的），其中约 35% 的条目
 * 有「旅游休闲 / 风景名胜 / 全国重点文物保护单位」这类段落，段内是干净的
 * 景点列表（`* [[天妃宫遗址]]`）—— 这就是现成的素材，不用再抓一遍正文。
 *
 * 纪律（与台湾那批一致）：
 *  1. **坐标一律现抓维基** `prop=coordinates`，不写死、不估算；
 *  2. **坐标必须落在该区县中心 150km 内**，否则多半串到同名地，丢弃；
 *  3. **简介取该景点自己的维基摘要首句**，没有摘要的景点宁可不要，不编；
 *  4. 提取不到就空着，绝不用通用词（图书馆 / 医院 / 学校）充数。
 *
 * 运行：node scripts/gen-wiki-spots.mjs [--limit=N] [--dry]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CACHE = join(ROOT, 'scripts/.cache/wiki');
const OUT = join(ROOT, 'scripts/content/wiki-spots.mjs');
const COORD_CACHE = join(ROOT, 'scripts/.cache/wiki-spot');
const API = 'https://zh.wikipedia.org/w/api.php';
const UA = 'shanhe-chengyi/0.9 (district content enrichment; local dev)';
const GAP_MS = 1400;
const BATCH = 50;
/** 景点坐标与区县中心的最大距离（km）——与 fetch-wiki-content.mjs 同一口径 */
const MAX_KM = 150;

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);
const DRY = process.argv.includes('--dry');

mkdirSync(COORD_CACHE, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 段落标题命中即视为「景点段」 */
const SEC_KEY =
  /风景名胜|風景名勝|旅游景点|旅遊景點|旅游休闲|旅遊休閒|旅游景区|旅遊景區|景点|景點|文物|古迹|古蹟|文物保护单位|文物保護單位|名勝|景观|景觀|旅遊|旅游/;

/** 明显不是景点的通用设施，命中就丢 */
const STOP_WORDS =
  /^(图书馆|圖書館|医院|醫院|学校|學校|大学|大學|中学|小學|小学|政府|人民法院|人民检察院|公安局|财政局|税务局|车站|火车站|汽车站|机场|机场|银行|商场|超市|工厂|公司|小区|社区|村委会|居委会|派出所|邮局|电信|移动|联通|体育馆|體育館|游泳馆|会展中心|科技园|工业园|开发区)/;
/** 太泛、不适合当景点的词 */
const TOO_GENERIC =
  /^(文化中心|体育中心|商业街|步行街|广场|人民广场|中心广场|时代广场|购物中心|百货|市场|菜市场|夜市|美食街|商业中心|行政中心|市民中心|会展|图书馆|博物馆)$/;
/**
 * 评定类别，不是景点名。
 * 维基条目常把「世界文化遗产」「中国国家5A级旅游景区」「全国重点文物保护单位」
 * 作为列表项罗列（蓟州区整段只抽出了这类词），必须剔除，否则会生成假景点。
 */
const IS_CATEGORY =
  /世界文化遗产|世界自然遗产|世界地质公园|非物质文化遗产|[0-9]A级|AAAA|AAA|国家级|國家級|省级|省級|市级|市級|县级|縣級|重点文物保护单位|重點文物保護單位|文物保护单位|文物保護單位|自然保护区|自然保護區|风景名胜区|風景名勝區|旅游景区|旅遊景區|森林公园|森林公園|地质公园|地質公園|湿地公园|濕地公園|示范区|示範區|保护区|保護區|名录|名錄|文化遗产|文化遺產|遗产|遺產|单位|單位|景区列表|景点列表/;

/** 从 wikitext 里取出景点段落的正文 */
function attractionSections(wikitext) {
  const re = /^==+\s*([^=\n]+?)\s*==+\s*$/gm;
  const hits = [...wikitext.matchAll(re)];
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const name = hits[i][1].trim();
    if (!SEC_KEY.test(name)) continue;
    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : wikitext.length;
    out.push(wikitext.slice(start, end));
  }
  return out;
}

/** 从段落正文里抽景点名：优先 [[链接]]（取显示名）、其次列表项纯文本 */
function extractNames(section) {
  const names = [];
  const seen = new Set();
  const push = (raw) => {
    let n = String(raw ?? '').trim();
    if (!n) return;
    // [[目标|显示]] → 显示；[[目标]] → 目标
    const m = n.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (m) n = (m[2] || m[1]).trim();
    // 去掉残留的括号说明与标注
    n = n.replace(/\(.*?\)|（.*?）/g, '').replace(/\[\[|\]\]/g, '').trim();
    // 「全国重点文物保护单位：治平寺石塔」→ 取冒号后的真名
    const colon = n.match(/^[^：:]{2,12}[：:]\s*(.+)$/);
    if (colon) n = colon[1].trim();
    if (n.length < 2 || n.length > 16) return;
    if (STOP_WORDS.test(n) || TOO_GENERIC.test(n) || IS_CATEGORY.test(n)) return;
    if (/^[\d\s.,、]+$/.test(n)) return;
    if (seen.has(n)) return;
    seen.add(n);
    names.push(n);
  };
  // 列表项：以 * 或 # 开头
  for (const line of section.split('\n')) {
    const t = line.trim();
    if (!/^[*#]/.test(t)) continue;
    push(t.replace(/^[*#]+\s*/, ''));
  }
  return names;
}

/** 大圆距离（km） */
function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 依名字/摘要猜标签，只从 8 个白名单里选 */
function guessTags(name, summary) {
  const s = `${name}${summary ?? ''}`;
  const tags = [];
  const add = (t) => {
    if (!tags.includes(t)) tags.push(t);
  };
  if (/寺|庙|廟|庵|观|觀|教堂|清真寺|道观/.test(s)) add('寺庙');
  if (/博物馆|博物館|纪念馆|紀念館|陈列馆|展馆/.test(s)) add('博物馆');
  if (/遗址|遺址|故里|旧居|故居|城墙|城牆|陵|墓|古城|古镇|古鎮|古街|老街|古村|衙署|会馆|會館|书院|書院/.test(s))
    add('历史文化');
  if (/山|峰|湖|江|河|峡|峽|谷|潭|溪|瀑布|温泉|溫泉|湿地|濕地|森林|国家公园|國家公園|草原|海岸|岛|島|海滨|海濱/.test(s))
    add('山水');
  if (/徒步|登山|步道|栈道|栈道|峡谷|峽谷|峰|山/.test(s)) add('徒步');
  if (/公园|公園|游乐园|遊樂園|乐园|動物园|动物园|景区/.test(s)) add('亲子');
  if (tags.length === 0) add('拍照');
  if (tags.length < 2) add('拍照');
  return tags.slice(0, 3);
}

/* ---------- 1. 收集候选 ---------- */
const districts = readJson(join(ROOT, 'public/content/districts.json'));
const spots = readJson(join(ROOT, 'public/content/spots.json'));
const have = new Set();
for (const v of spots) have.add(v.districtId);

let queue = districts.filter((d) => !have.has(d.id));
if (LIMIT > 0) queue = queue.slice(0, LIMIT);

const candidates = [];
for (const d of queue) {
  const p = join(CACHE, `${d.id}.json`);
  if (!existsSync(p)) continue;
  const j = readJson(p);
  const wt = j.extract ?? j.wikitext ?? '';
  if (!wt) continue;
  const names = [];
  for (const sec of attractionSections(wt)) {
    for (const n of extractNames(sec)) {
      if (names.length >= 5) break;
      names.push(n);
    }
    if (names.length >= 5) break;
  }
  if (names.length) candidates.push({ district: d, names });
}
console.log(`· 候选：${candidates.length} 个区县 / ${candidates.reduce((a, c) => a + c.names.length, 0)} 个景点名`);
if (DRY) {
  for (const c of candidates.slice(0, 8)) console.log(`   ${c.district.name}: ${c.names.join('、')}`);
  process.exit(0);
}

/* ---------- 2. 批量抓坐标 + 摘要 ---------- */
const byName = new Map();
for (const c of candidates) for (const n of c.names) if (!byName.has(n)) byName.set(n, []);
const allNames = [...byName.keys()];
console.log(`· 需查坐标：${allNames.length} 个不重名景点`);

const infoByName = new Map();
const cacheFile = join(COORD_CACHE, 'spot-info.json');
if (existsSync(cacheFile)) {
  for (const [k, v] of Object.entries(readJson(cacheFile))) infoByName.set(k, v);
}
const todo = allNames.filter((n) => !infoByName.has(n));
console.log(`   缓存命中 ${allNames.length - todo.length}，待抓 ${todo.length}`);

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'coordinates|extracts',
    titles: batch.join('|'),
    redirects: '1',
    explaintext: '1',
    exintro: '1',
    exlimit: 'max',
    colimit: 'max',
    variant: 'zh-cn',
  });
  let json = null;
  for (let attempt = 0; attempt < 3 && !json; attempt++) {
    const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': UA } });
    if (res.ok) json = await res.json();
    else {
      console.error(`  ! HTTP ${res.status}，${attempt + 1}/3 后重试`);
      await sleep(GAP_MS * (attempt + 2));
    }
  }
  if (!json) {
    console.error(`  ! 批次 ${i / BATCH + 1} 放弃`);
    continue;
  }
  const alias = new Map();
  for (const r of json?.query?.redirects ?? []) alias.set(r.from, r.to);
  for (const n of json?.query?.normalized ?? []) alias.set(n.from, n.to);
  const byTitle = new Map(Object.values(json?.query?.pages ?? {}).map((p) => [p.title, p]));
  for (const name of batch) {
    const p = byTitle.get(alias.get(name) ?? name) ?? byTitle.get(name);
    const coords = p?.coordinates?.[0] ? [p.coordinates[0].lon, p.coordinates[0].lat] : null;
    const intro = (p?.extract ?? '').trim();
    infoByName.set(name, { title: p?.title ?? name, coords, intro });
  }
  await sleep(GAP_MS);
  if ((i / BATCH) % 10 === 0) console.log(`   … ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
}
writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(infoByName)));

/* ---------- 3. 组装 ---------- */
const additions = {};
let kept = 0;
let droppedNoCoord = 0;
let droppedFar = 0;
let droppedNoIntro = 0;
const usedIds = new Set();

for (const c of candidates) {
  const list = [];
  for (const name of c.names) {
    const info = infoByName.get(name);
    if (!info?.coords) {
      droppedNoCoord += 1;
      continue;
    }
    const center = c.district.center;
    if (center && haversine(info.coords[0], info.coords[1], center[0], center[1]) > MAX_KM) {
      droppedFar += 1;
      continue;
    }
    // 摘要取首句，太短说明条目本身没内容，宁可不写
    const sentence = info.intro.split(/[。！？\n]/)[0]?.trim() ?? '';
    if (sentence.length < 12) {
      droppedNoIntro += 1;
      continue;
    }
    const id = `w-${c.district.id}-${list.length}`;
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    const tags = guessTags(name, sentence);
    const suitable = tags.includes('山水') || tags.includes('徒步') ? ['徒步', '拍照'] : ['拍照'];
    const duration = tags.includes('山水') ? '半天' : '2小时';
    list.push([
      id,
      name,
      +info.coords[0].toFixed(5),
      +info.coords[1].toFixed(5),
      sentence.slice(0, 90),
      tags,
      false,
      suitable,
      duration,
    ]);
    kept += 1;
  }
  if (list.length) additions[c.district.id] = list;
}

console.log(
  `· 采纳 ${kept} 个景点 / 覆盖 ${Object.keys(additions).length} 个区县` +
    `（无坐标丢 ${droppedNoCoord}、超出 ${MAX_KM}km 丢 ${droppedFar}、无摘要丢 ${droppedNoIntro}）`,
);

if (DRY) process.exit(0);

const body = Object.entries(additions)
  .map(([id, list]) => {
    const rows = list
      .map(
        (s) =>
          `    ${JSON.stringify(s)},`,
      )
      .join('\n');
    return `  '${id}': [\n${rows}\n  ],`;
  })
  .join('\n');

writeFileSync(
  OUT,
  `/**
 * 【自动生成，勿手改】由 scripts/gen-wiki-spots.mjs 生成。
 *
 * 从中文维基百科条目里提取的全国区县景点：段落命中「旅游休闲 / 风景名胜 /
 * 全国重点文物保护单位」等，段内列表项即景点名；坐标与简介均取自维基条目本身，
 * 坐标须落在该区县中心 ${MAX_KM}km 内才采纳。
 *
 * build-content.mjs 会把这里的内容并入对应区县（与人工录入的景点合并）。
 */
export const WIKI_SPOT_ADDITIONS = {
${body}
};
`,
);
console.log(`· 写出 ${OUT}`);
