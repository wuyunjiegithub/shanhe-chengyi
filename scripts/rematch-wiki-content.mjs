/**
 * 二次匹配：把「抓到消歧义页」和「根本没抓到」的区县重新对准正确条目。
 *
 * 首轮抓取（fetch-wiki-content.mjs）的两个已知问题：
 *   ① 「和平区」这类裸名在维基上是**消歧义页**（开头「XX可以指：」），
 *      真正条目叫「和平区 (天津市)」；
 *   ② 消歧义页的正文里也含省市名，首轮的打分把消歧义页和真条目判成同分，
 *      裸名先入为主就赢了 → 235 个区县对错了页。
 *
 * 本脚本：
 *   - 候选顺序改成「名称 (城市) → 名称 (省份) → 名称」，具体标题优先
 *   - 显式识别并否决消歧义页
 *   - 导语必须同时含区县名（去后缀）与省/市，排除同名外地条目
 *   - 三个候选都不中时，用搜索 API 兜底
 *
 * 产物：就地更新 scripts/.cache/wiki/<districtId>.json
 * 运行：node scripts/rematch-wiki-content.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const GEO_DIR = join(ROOT, 'public/geo');
const CONTENT_DIR = join(ROOT, 'scripts/content');
const CACHE_DIR = join(ROOT, 'scripts/.cache/wiki');
const UA = 'shanhe-chengyi/0.9 (district content enrichment; local dev)';
const API = 'https://zh.wikipedia.org/w/api.php';
const GAP_MS = 1400;
const BATCH = 50;

mkdirSync(CACHE_DIR, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 人工录入的区县（不动） ---------- */
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
    if (curated.has(id)) continue;
    all.push({
      id,
      name,
      city: city.name,
      province: f.properties?.province ?? city.province,
      center: f.properties?.centroid ?? f.properties?.center ?? null,
    });
  }
}

/* ---------- 判定需要重来的区县 ---------- */
const isDisamb = (text) => /^[^。\n]{2,24}可以指[:：]/.test((text ?? '').trim());
const problems = [];
for (const t of all) {
  const p = join(CACHE_DIR, `${t.id}.json`);
  if (!existsSync(p)) {
    problems.push(t);
    continue;
  }
  const rec = readJson(p);
  if (!rec.extract || isDisamb(rec.extract)) problems.push(t);
}
console.log(`· 需重新匹配 ${problems.length} 个（未抓到 ${problems.filter((t) => !existsSync(join(CACHE_DIR, `${t.id}.json`))).length} / 抓到消歧义页 ${problems.filter((t) => { const p = join(CACHE_DIR, `${t.id}.json`); return existsSync(p) && isDisamb(readJson(p).extract); }).length}）`);

/* ---------- API ---------- */
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
      res = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': UA } });
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
  for (const p of j.query?.pages ?? []) {
    if (p.missing || !p.revisions) continue;
    const text = p.revisions?.[0]?.slots?.main?.content ?? '';
    if (!text) continue;
    const c = p.coordinates?.[0];
    out.set(p.title, { title: p.title, text, coords: c && c.lat != null ? [c.lon, c.lat] : null });
  }
  return out;
}

/* ---------- 候选标题 ---------- */
const perDistrict = new Map();
const allTitles = new Set();
for (const t of problems) {
  const list = [`${t.name} (${t.city})`, `${t.name} (${t.province})`, t.name];
  perDistrict.set(t.id, list);
  for (const title of list) allTitles.add(title);
}
const titles = [...allTitles];
console.log(`· 候选标题 ${titles.length} 个`);

const pages = new Map();
for (let i = 0; i < titles.length; i += BATCH) {
  const got = await fetchBatch(titles.slice(i, i + BATCH));
  for (const [title, entry] of got) pages.set(title, entry);
}
console.log(`· 抓取完成：命中标题 ${pages.size} / ${titles.length}（${calls} 次请求）`);

/* ---------- 评分 ---------- */
const stem = (name) => name.replace(/(自治县|自治旗|新区|区|县|市|旗)$/g, '');

function scoreArticle(text, title, t) {
  if (!text) return null;
  if (isDisamb(text)) return null; // 消歧义页直接否决
  const head = text.slice(0, 700);
  const st = stem(t.name);
  const nameHit = head.includes(t.name) || (st.length >= 2 && head.includes(st));
  if (!nameHit) return null;
  if (!head.includes(t.province) && !head.includes(t.city)) return null;
  // 标题越具体越可信：「名 (城市)」优于裸名
  return title.includes('(') ? 0 : 100;
}

let fixed = 0;
let stillBad = 0;
for (const t of problems) {
  let best = null;
  let bestScore = Infinity;
  for (const title of perDistrict.get(t.id) ?? []) {
    const page = pages.get(title);
    if (!page) continue;
    const s = scoreArticle(page.text, title, t);
    if (s === null) continue;
    if (s < bestScore) {
      bestScore = s;
      best = page;
    }
  }
  if (best) {
    writeFileSync(
      join(CACHE_DIR, `${t.id}.json`),
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
    fixed++;
  } else {
    stillBad++;
  }
}
console.log(`· 修正 ${fixed} 个，仍未找到 ${stillBad} 个`);

/* ---------- 搜索兜底 ---------- */
if (stillBad > 0) {
  const rest = problems.filter((t) => {
    const rec = readJson(join(CACHE_DIR, `${t.id}.json`));
    return !rec.extract || isDisamb(rec.extract);
  });
  console.log(`· 搜索兜底 ${rest.length} 个`);
  let found = 0;
  for (const t of rest) {
    try {
      const j = await apiGet({
        action: 'query',
        format: 'json',
        formatversion: '2',
        list: 'search',
        srsearch: `${t.name} ${t.province}`,
        srlimit: '8',
      });
      const hits = (j.query?.search ?? []).filter((h) => h.title.includes(t.name)).slice(0, 4);
      for (const h of hits) {
        const got = await fetchBatch([h.title]);
        const page = got.get(h.title);
        if (!page) continue;
        if (scoreArticle(page.text, h.title, t) === null) continue;
        writeFileSync(
          join(CACHE_DIR, `${t.id}.json`),
          JSON.stringify(
            {
              id: t.id,
              name: t.name,
              city: t.city,
              province: t.province,
              title: page.title,
              extract: page.text.slice(0, 40000),
              coords: page.coords,
            },
            null,
            1,
          ),
          'utf8',
        );
        found++;
        break;
      }
    } catch (err) {
      console.log(`  ! ${t.name}：${err.message}`);
    }
  }
  console.log(`· 搜索兜底补上 ${found} 个`);
}
console.log(`· 累计请求 ${calls} 次`);
