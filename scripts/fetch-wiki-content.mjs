/**
 * 抓取全国区县的「维基百科」条目正文，落到本地缓存。
 *
 * 背景：gen-baseline-content.mjs 只写入真实行政区信息（名称 / 隶属 / 面积），
 * 人文 / 历史 / 景点一律留空 —— 凭空编造 2500 个区县的通史是不可接受的。
 * 这里从中文维基百科抓取**真实可核查**的条目正文作为补全素材，
 * 由 gen-baseline-content.mjs 再据此填 history / culture / features / people / spots。
 *
 * 抓取策略（对维基友好）：
 *   - 一次请求 50 个标题（prop=revisions 取 wikitext + prop=coordinates 取坐标）
 *   - 全局串行、每次请求间隔 1.4s，避免触发 429
 *   - 同名区县（「城关区」全国几十个）用「名称 (城市)」消歧，
 *     并用条目坐标与区县中心点比对，确保不会串到别的省份的同名地
 *
 * 产物：scripts/.cache/wiki/<districtId>.json
 *   { id, name, city, province, title, extract, coords: [lng, lat] | null }
 *   另有 scripts/.cache/wiki-spot/<hash>.json 存景点条目的坐标。
 *
 * 运行：node scripts/fetch-wiki-content.mjs            （增量，已缓存的跳过）
 *       node scripts/fetch-wiki-content.mjs --limit 50 （试跑）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const GEO_DIR = join(ROOT, 'public/geo');
const CONTENT_DIR = join(ROOT, 'scripts/content');
const CACHE_DIR = join(ROOT, 'scripts/.cache/wiki');
const SPOT_CACHE_DIR = join(ROOT, 'scripts/.cache/wiki-spot');
const UA = 'shanhe-chengyi/0.9 (district content enrichment; local dev)';
const API = 'https://zh.wikipedia.org/w/api.php';

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);
/** 每次请求的间隔（ms）：维基对匿名批量请求很敏感，宁慢勿 429 */
const GAP_MS = 1400;
const BATCH = 50;
/** 条目坐标与区县中心点的最大容差（km）：超过多半是串到同名地了 */
const MAX_MATCH_KM = 250;

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(SPOT_CACHE_DIR, { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 已人工录入的区县（不抓，交给人工内容） ---------- */
const curated = new Set();
for (const file of readdirSync(CONTENT_DIR).sort()) {
  if (!file.endsWith('.mjs')) continue;
  if (file === 'cities.mjs' || file === 'auto-baseline.mjs' || file === 'auto-city-meta.mjs') continue;
  const mod = await import(pathToFileURL(join(CONTENT_DIR, file)).href);
  for (const d of mod.districts ?? mod.default ?? []) curated.add(String(d.id));
}

/* ---------- 全部区县 ---------- */
const cityGeo = readJson(join(GEO_DIR, 'cities.geojson'));
const cityById = new Map(
  (cityGeo.features ?? []).map((f) => [
    String(f.properties.id),
    { name: f.properties.name, province: f.properties.province },
  ]),
);

const all = [];
for (const file of readdirSync(join(GEO_DIR, 'districts')).sort()) {
  if (!file.endsWith('.geojson')) continue;
  const cityId = file.replace('.geojson', '');
  const city = cityById.get(cityId);
  if (!city) continue;
  const fc = readJson(join(GEO_DIR, 'districts', file));
  for (const f of fc.features ?? []) {
    const id = String(f.properties?.id ?? f.properties?.adcode ?? '');
    const name = f.properties?.name ?? '';
    if (!id || !name) continue;
    all.push({
      id,
      name,
      city: city.name,
      province: f.properties?.province ?? city.province,
      center: f.properties?.centroid ?? f.properties?.center ?? null,
      need: !curated.has(id),
    });
  }
}
const pending = all.filter((t) => t.need);
console.log(`· 全国区县 ${all.length} 个（人工已录入 ${curated.size} 个，只补其余 ${pending.length} 个）`);

/* ---------- 同名统计 ---------- */
const nameCount = new Map();
for (const t of pending) nameCount.set(t.name, (nameCount.get(t.name) ?? 0) + 1);

/* ---------- API 封装（全局串行 + 退避重试） ---------- */
let lastCall = 0;
let calls = 0;

async function apiGet(params) {
  for (let attempt = 0; ; attempt++) {
    const wait = GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    calls++;
    let res;
    try {
      res = await fetch(`${API}?${new URLSearchParams(params)}`, {
        headers: { 'User-Agent': UA },
      });
    } catch (err) {
      if (attempt >= 6) throw err;
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error(`HTTP ${res.status}`);
      await sleep(Math.min(90000, 5000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
}

/** 批量取一批标题的 wikitext + 坐标 */
async function fetchBatch(titles) {
  const j = await apiGet({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions|coordinates',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    titles: titles.join('|'),
  });
  const out = new Map();
  const normalized = j.query?.normalized ?? [];
  const redirects = j.query?.redirects ?? [];
  const alias = new Map();
  for (const n of normalized) alias.set(n.to, n.from);
  for (const r of redirects) alias.set(r.to, r.from);
  for (const p of j.query?.pages ?? []) {
    if (p.missing || !p.revisions) continue;
    const text = p.revisions?.[0]?.slots?.main?.content ?? '';
    const c = p.coordinates?.[0];
    const entry = {
      title: p.title,
      text,
      coords: c && c.lat != null ? [c.lon, c.lat] : null,
    };
    out.set(p.title, entry);
    // 别名（重定向 / 规范化前的标题）也指回同一条
    const from = alias.get(p.title);
    if (from) out.set(from, entry);
  }
  return out;
}

/** 两点球面距离（km） */
function distKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ---------- 候选标题 ---------- */
// 每个区县的候选标题：裸名 + 「名 (城市)」+「名 (省份)」。
// 裸名在同名区县里可能被别的省占了，靠坐标比对来排除。
const candidates = new Map(); // title -> Set(districtId)
const perDistrict = new Map(); // districtId -> [title...]
for (const t of pending) {
  // 具体标题优先：裸名可能是消歧义页
  const list = [`${t.name} (${t.city})`, `${t.name} (${t.province})`, t.name];
  perDistrict.set(t.id, list);
  for (const title of list) {
    if (!candidates.has(title)) candidates.set(title, new Set());
    candidates.get(title).add(t.id);
  }
}
const allTitles = [...candidates.keys()];
console.log(`· 候选标题 ${allTitles.length} 个（同名区县 ${[...nameCount.values()].filter((v) => v > 1).length} 组）`);

/* ---------- 抓取 ---------- */
const pages = new Map(); // title -> {title,text,coords}
const todo = LIMIT ? pending.slice(0, LIMIT) : pending;
const todoIds = new Set(todo.map((t) => t.id));
const titlesToFetch = allTitles.filter((title) => {
  if (LIMIT) return [...candidates.get(title)].some((id) => todoIds.has(id));
  return true;
});

let doneBatches = 0;
for (let i = 0; i < titlesToFetch.length; i += BATCH) {
  const batch = titlesToFetch.slice(i, i + BATCH);
  try {
    const got = await fetchBatch(batch);
    for (const [title, entry] of got) pages.set(title, entry);
  } catch (err) {
    console.log(`  ! 批次失败（${batch[0]}…）：${err.message}`);
  }
  doneBatches++;
  if (doneBatches % 5 === 0) {
    console.log(`  … 标题批次 ${doneBatches}/${Math.ceil(titlesToFetch.length / BATCH)}（已取 ${pages.size}）`);
  }
}
console.log(`· 标题抓取完成：${pages.size} / ${titlesToFetch.length}，共 ${calls} 次请求`);

/* ---------- 给每个区县挑最贴的那一条 ---------- */
// 裸名在维基上可能是**消歧义页**（开头「XX可以指：」），真正的条目叫「名称 (城市)」。
// 打分规则：否决消歧义页；导语必须同时含区县名与省/市；标题越具体越可信。
const isDisamb = (text) => /^[^。\n]{2,24}可以指[:：]/.test((text ?? '').trim());
const stemOf = (name) => name.replace(/(自治县|自治旗|新区|区|县|市|旗)$/g, '');

function scoreArticle(text, title, t) {
  if (!text || isDisamb(text)) return null;
  const head = text.slice(0, 700);
  const st = stemOf(t.name);
  const nameHit = head.includes(t.name) || (st.length >= 2 && head.includes(st));
  if (!nameHit) return null;
  if (!head.includes(t.province) && !head.includes(t.city)) return null;
  return title.includes('(') ? 0 : 100;
}

let matched = 0;
let unmatched = 0;
for (const t of todo) {
  const list = perDistrict.get(t.id) ?? [t.name];
  let best = null;
  let bestScore = Infinity;
  for (const title of list) {
    const page = pages.get(title);
    if (!page) continue;
    const s = scoreArticle(page.text, title, t);
    if (s === null) continue;
    if (s < bestScore) {
      bestScore = s;
      best = { title, text: page.text, coords: page.coords };
    }
  }
  const cachePath = join(CACHE_DIR, `${t.id}.json`);
  if (best) {
    writeFileSync(
      cachePath,
      JSON.stringify(
        {
          id: t.id,
          name: t.name,
          city: t.city,
          province: t.province,
          title: best.title,
          extract: best.text.slice(0, 40000),
          coords: best.coords,
        },
        null,
        1,
      ),
      'utf8',
    );
    matched++;
  } else {
    writeFileSync(
      cachePath,
      JSON.stringify(
        { id: t.id, name: t.name, city: t.city, province: t.province, title: null, extract: '', coords: null },
        null,
        1,
      ),
      'utf8',
    );
    unmatched++;
  }
}
console.log(`· 区县匹配：命中 ${matched} / 未找到 ${unmatched}`);

/* ---------- 景点坐标：批量取 ---------- */
const SPOT_SECTIONS = /风景名胜|旅游景点|主要景点|景区|名胜|旅游|景点|文物/;
const CAND_RE = /^[\u4e00-\u9fa5A-Za-z0-9·（）()—\- ]{2,18}$/;
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

const candidateNames = new Set();
for (const file of readdirSync(CACHE_DIR)) {
  if (!file.endsWith('.json')) continue;
  const rec = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8'));
  const text = rec.extract ?? '';
  let inSection = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const head = /^==+\s*(.+?)\s*==+$/.exec(line);
    if (head) {
      inSection = SPOT_SECTIONS.test(head[1]);
      continue;
    }
    if (!inSection) continue;
    const item = /^[*#]+\s*(.+)$/.exec(line);
    if (!item) continue;
    const name = item[1].split(/[：:，,、（(]/)[0].trim();
    if (name && CAND_RE.test(name) && !/^(上述|本区|境内|其中|以及|还有|另有|著名|主要|其他)/.test(name)) {
      candidateNames.add(name);
    }
  }
}
console.log(`· 候选景点名 ${candidateNames.size} 个，开始批量取坐标`);

const names = [...candidateNames];
let spotOk = 0;
for (let i = 0; i < names.length; i += BATCH) {
  const batch = names.slice(i, i + BATCH);
  try {
    const j = await apiGet({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'coordinates',
      redirects: '1',
      titles: batch.join('|'),
    });
    for (const page of j.query?.pages ?? []) {
      if (!page.title || page.missing) continue;
      const c = page.coordinates?.[0];
      if (!c) continue;
      writeFileSync(
        join(SPOT_CACHE_DIR, `${hashOf(page.title)}.json`),
        JSON.stringify({ title: page.title, lng: c.lon, lat: c.lat }, null, 1),
        'utf8',
      );
      spotOk++;
    }
  } catch (err) {
    console.log(`  ! 景点坐标批次失败：${err.message}`);
  }
  if (i % 1000 === 0) console.log(`  … 景点坐标 ${i}/${names.length}`);
}
console.log(`· 景点坐标缓存完成：${spotOk} 个（共 ${calls} 次请求）`);
