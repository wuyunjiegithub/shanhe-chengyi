/**
 * 从 OpenStreetMap（Overpass API）抓取真实带坐标的景点 POI，补足维基覆盖不到的区县。
 *
 * 现状：维基百科只给到 ~366 个景点名坐标，导致 2509 个基线条目里 2058 个（82%）完全没有景点。
 * OSM 的 tourism / historic 标签几乎覆盖每个区县，是 scalable 的真实数据源（ODbL 授权，已获用户确认）。
 *
 * 策略：
 *   - 按「市」bbox 查询 Overpass 的 tourism + historic 带名称 POI（out center tags）。
 *   - 用射线法（ray casting）把每个 POI 落入其所属区县多边形，归属到具体区县。
 *   - 仅保留白名单内的 (key,value)，并映射成项目 8 个标签之一（校验会拦未知标签）。
 *   - 每市缓存到 scripts/.cache/osm-spots/<cityId>.json，增量、可重跑。
 *
 * 运行：
 *   node scripts/fetch-osm-spots.mjs                 （全量 352 市，后台跑）
 *   node scripts/fetch-osm-spots.mjs --city 330600   （单市试跑）
 *   node scripts/fetch-osm-spots.mjs --limit 5       （前 N 市试跑）
 */
import { readFileSync, writeFileSync, renameSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const GEO_DIR = join(ROOT, 'public/geo');
const CACHE_DIR = join(ROOT, 'scripts/.cache/osm-spots');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'shanhe-chengyi/0.9 (district content enrichment; OSM POI harvest; contact: local-dev)';
const GAP_MS = 1800; // Overpass 公共实例公平使用，宁慢勿 429

function getArg(name) {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}
const LIMIT = Number(getArg('limit') ?? 0);
const OFFSET = Number(getArg('offset') ?? 0);
const CITY_ARG = getArg('city');

mkdirSync(CACHE_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---------- (key,value) → 项目标签 白名单 ---------- */
// 项目标签白名单：古镇/山水/博物馆/寺庙/亲子/拍照/徒步/历史文化
const TYPE_MAP = {
  'tourism:museum': ['博物馆'],
  'tourism:gallery': ['拍照'],
  'tourism:exhibition_centre': ['博物馆'],
  'tourism:artwork': ['拍照'],
  'tourism:theme_park': ['亲子'],
  'tourism:zoo': ['亲子'],
  'tourism:aquarium': ['亲子'],
  'tourism:amusement_park': ['亲子'],
  'tourism:viewpoint': ['拍照'],
  'tourism:attraction': ['拍照'],
  'tourism:picnic_site': ['亲子'],
  'historic:temple': ['寺庙'],
  'historic:shrine': ['寺庙'],
  'historic:monastery': ['寺庙'],
  'historic:church': ['寺庙'],
  'historic:mosque': ['寺庙'],
  'historic:castle': ['历史文化'],
  'historic:ruins': ['历史文化'],
  'historic:fort': ['历史文化'],
  'historic:fortress': ['历史文化'],
  'historic:archaeological_site': ['历史文化'],
  'historic:monument': ['历史文化'],
  'historic:battlefield': ['历史文化'],
  'historic:memorial': ['历史文化'],
  'historic:museum': ['博物馆'],
  'historic:castle': ['历史文化'],
  'natural:peak': ['山水', '徒步'],
  'natural:mountain': ['山水', '徒步'],
  'natural:volcano': ['山水'],
  'leisure:park': ['拍照'],
};
function mapTags(tags) {
  for (const [k, v] of Object.entries(TYPE_MAP)) {
    const [key, val] = k.split(':');
    if (tags[key] === val) return v;
  }
  return null;
}
function kindLabel(tags) {
  if (tags.tourism) return `OSM:${tags.tourism}`;
  if (tags.historic) return `OSM:${tags.historic}`;
  if (tags.natural) return `OSM:${tags.natural}`;
  if (tags.leisure) return `OSM:${tags.leisure}`;
  return 'OSM';
}

/* ---------- 射线法点在多边形内 ---------- */
function pointInRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') {
    if (!pointInRing(pt, geom.coordinates[0])) return false;
    for (let i = 1; i < geom.coordinates.length; i++) {
      if (pointInRing(pt, geom.coordinates[i])) return false; // 落在洞里
    }
    return true;
  }
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      if (!pointInRing(pt, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(pt, poly[i])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

/* ---------- 城市表 + bbox ---------- */
const cityGeo = readJson(join(GEO_DIR, 'cities.geojson'));
const cityById = new Map(
  cityGeo.features.map((f) => [String(f.properties.id), f.properties]),
);

// 列出有区县 geojson 的城市
const districtFiles = readdirSync(join(GEO_DIR, 'districts')).filter((f) => f.endsWith('.geojson'));
let targets = districtFiles.map((f) => f.replace('.geojson', ''));
if (CITY_ARG) targets = targets.filter((id) => id === CITY_ARG);
if (LIMIT) targets = targets.slice(OFFSET, OFFSET + LIMIT);
console.log(`· 目标城市 ${targets.length} 个（offset=${OFFSET}）`);

/* ---------- Overpass 查询 ---------- */
let lastCall = 0;
let calls = 0;
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    const wait = GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    calls++;
    let res;
    try {
      res = await fetch(ep, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
    } catch (err) {
      lastErr = err;
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status === 504 || res.status >= 500) {
      lastErr = new Error(`HTTP ${res.status}`);
      await sleep(Math.min(90000, 5000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
  throw lastErr ?? new Error('overpass failed');
}

function bboxOf(fc) {
  let s = 90, w = 180, n = -90, e = -180;
  const scan = (coords) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords;
      if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
    } else coords.forEach(scan);
  };
  for (const f of fc.features ?? []) scan(f.geometry?.coordinates ?? []);
  return [s, w, n, e];
}

function buildQuery(bbox) {
  const [s, w, n, e] = bbox;
  // 只抓白名单内的 (key,value)，避免 tourism=* 拉回海量酒店等噪声、压低响应体积
  const clauses = [];
  for (const k of Object.keys(TYPE_MAP)) {
    const [key, val] = k.split(':');
    clauses.push(`  node["${key}"="${val}"](${s},${w},${n},${e});`);
    clauses.push(`  way["${key}"="${val}"](${s},${w},${n},${e});`);
  }
  return `[out:json][timeout:120];
(
${clauses.join('\n')}
);
out center tags;`;
}

/* ---------- 逐市抓取 + PIP 归属 ---------- */
let totalPoi = 0;
let totalAssigned = 0;
for (const cityId of targets) {
  const cachePath = join(CACHE_DIR, `${cityId}.json`);
  if (existsSync(cachePath) && !CITY_ARG) {
    console.log(`  · 跳过已缓存 ${cityId}`);
    continue;
  }
  const city = cityById.get(cityId);
  console.log(`  · 抓取中 ${cityId} ${city?.name ?? ''} …`);
  try {
  const fc = readJson(join(GEO_DIR, 'districts', `${cityId}.geojson`));
  const bbox = bboxOf(fc);
  let data;
  try {
    data = await overpass(buildQuery(bbox));
  } catch (err) {
    console.log(`  ! ${cityId} 查询失败：${err.message}`);
    continue;
  }
  // districtId → geometry + name
  const distGeom = new Map();
  for (const f of fc.features ?? []) {
    const id = String(f.properties?.id ?? f.properties?.adcode ?? '');
    if (id) distGeom.set(id, { geom: f.geometry, name: f.properties?.name ?? '' });
  }
  // 解析元素
  const collected = {}; // districtId -> [poi]
  let poiCount = 0;
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    if (!tags.name) continue;
    const tags_mapped = mapTags(tags);
    if (!tags_mapped) continue; // 不在白名单
    let lng, lat;
    if (el.type === 'node') { lng = el.lon; lat = el.lat; }
    else if (el.center) { lng = el.center.lon; lat = el.center.lat; }
    else continue;
    if (lng == null || lat == null) continue;
    poiCount++;
    // 归属到区县
    for (const [did, info] of distGeom) {
      if (pointInPolygon([lng, lat], info.geom)) {
        (collected[did] ??= []).push({
          name: tags.name,
          lng: Math.round(lng * 1e5) / 1e5,
          lat: Math.round(lat * 1e5) / 1e5,
          kind: kindLabel(tags),
          tags: tags_mapped,
        });
        break;
      }
    }
  }
  // 每区县去重（同名）+ 限 12 个
  const out = {};
  let assigned = 0;
  for (const [did, list] of Object.entries(collected)) {
    const seen = new Set();
    const uniq = [];
    for (const p of list) {
      const key = p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(p);
    }
    out[did] = uniq.slice(0, 12);
    assigned += out[did].length;
  }
  const tmpPath = cachePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(out, null, 1), 'utf8');
  renameSync(tmpPath, cachePath);
  totalPoi += poiCount;
  totalAssigned += assigned;
  console.log(`  ✓ ${cityId} ${city?.name ?? ''}：POI ${poiCount} → 归属 ${assigned}（覆盖 ${Object.keys(out).length} 区县）`);
  } catch (err) {
    console.log(`  ! ${cityId} 处理失败：${err?.message ?? err}`);
  }
}

console.log(`\n· 完成：共 ${calls} 次请求，POI ${totalPoi}，归属 ${totalAssigned}`);
