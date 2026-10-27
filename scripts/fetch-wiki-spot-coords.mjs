/**
 * 补抓景点条目的坐标。
 *
 * fetch-wiki-content.mjs 里那一轮是从**原始 wikitext** 里挑景点名的，
 * 而真正的解析器用的是清洗后的纯文本 —— 两边挑出来的名字对不上，
 * 导致坐标命中率极低。本脚本按解析器同一套规则（scripts/lib/wiki-enrich.mjs 的
 * toPlain + 景点段落）重新挑一遍候选名，再批量取坐标。
 *
 * 产物：scripts/.cache/wiki-spot/<hash>.json
 * 运行：node scripts/fetch-wiki-spot-coords.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, 'scripts/.cache/wiki');
const SPOT_CACHE_DIR = join(ROOT, 'scripts/.cache/wiki-spot');
const UA = 'shanhe-chengyi/0.9 (district content enrichment; local dev)';
const API = 'https://zh.wikipedia.org/w/api.php';
const GAP_MS = 1400;
const BATCH = 50;

mkdirSync(SPOT_CACHE_DIR, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/* ---------- 与解析器同源的 wikitext → 纯文本 ---------- */
function toPlain(wt) {
  let s = wt ?? '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<ref[^>]*>[\s\S]*$/gi, '');
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\{\{[^{}]*\}\}/g, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/<[^>]{0,80}>/g, '');
  s = s.replace(/\[\[(?:File|Image|文件|图像):[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\]/g, '');
  s = s.replace(/'''?/g, '');
  s = s.replace(/^[ \t]*\|+([^\n]*)$/gm, (line) => {
    const cells = line
      .split('||')
      .map((c) => c.replace(/^\|+/, '').replace(/\[\d+\]/g, '').trim())
      .filter(Boolean);
    return cells.join(' · ');
  });
  s = s.replace(/^[ \t]*[{}!][^\n]*$/gm, '');
  return s;
}

/* ---------- 挑候选景点名 ---------- */
const SPOT_SECTIONS = /风景名胜|旅游景点|主要景点|景区|名胜|旅游|景点|文物/;
const CAND_RE = /^[\u4e00-\u9fa5A-Za-z0-9·（）()—\- ]{2,18}$/;

const candidates = new Set();
for (const file of readdirSync(CACHE_DIR)) {
  if (!file.endsWith('.json')) continue;
  const rec = readJson(join(CACHE_DIR, file));
  if (!rec.extract) continue;
  const text = toPlain(rec.extract);
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
    if (name && CAND_RE.test(name) && !/^(上述|本区|境内|其中|以及|还有|另有|著名|主要|其他|相传|据说|现存|今属)/.test(name)) {
      candidates.add(name);
    }
  }
}
console.log(`· 候选景点名 ${candidates.size} 个（与解析器同源）`);

/* ---------- 已有坐标 ---------- */
const have = new Set();
if (existsSync(SPOT_CACHE_DIR)) {
  for (const f of readdirSync(SPOT_CACHE_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = readJson(join(SPOT_CACHE_DIR, f));
      if (j?.title && typeof j.lng === 'number') have.add(j.title);
    } catch {
      /* 忽略坏缓存 */
    }
  }
}
const names = [...candidates].filter((n) => !have.has(n));
console.log(`· 已有坐标 ${have.size} 个，待取 ${names.length} 个`);

/* ---------- 批量取坐标 ---------- */
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

let ok = 0;
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
      ok++;
    }
  } catch (err) {
    console.log(`  ! 批次失败：${err.message}`);
  }
  if (i % 500 === 0) console.log(`  … ${i}/${names.length}`);
}
console.log(`· 新增景点坐标 ${ok} 个（共 ${calls} 次请求）`);
