/**
 * 生成「全国基线内容」：给尚未人工录入的区县铺一条最基础的条目，
 * 让全国再没有「待录入」的空白。
 *
 * 只写入**真实可计算**的信息：
 *   - 区县名 / 所属地级市 / 所属省份（来自民政部行政区划，经 DataV 边界数据落地）
 *   - 中心点经纬度（边界数据自带 centroid）
 *   - 面积（由边界多边形按球面公式算出，单位 km²）
 * 人文 / 历史 / 特色 / 美食 / 景点一律留空，等后续按省人工精写补上——
 * 不给 2840 个区县编造简介和标签。
 *
 * 产物：
 *   scripts/content/auto-baseline.mjs   （区县基线条目）
 *   scripts/content/auto-city-meta.mjs  （未录入城市的最小元信息：intro）
 *
 * 运行：node scripts/gen-baseline-content.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const GEO_DIR = join(ROOT, 'public/geo');
const CONTENT_DIR = join(ROOT, 'scripts/content');
const BASELINE_FILE = 'auto-baseline.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---------- 球面多边形面积（km²） ---------- */
const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
function ringArea(ring) {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += (rad(lon2) - rad(lon1)) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * R * R) / 2);
}
function geomArea(geometry) {
  if (!geometry) return 0;
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    let a = ringArea(coordinates[0]);
    for (let i = 1; i < coordinates.length; i++) a -= ringArea(coordinates[i]);
    return Math.max(a, 0);
  }
  if (type === 'MultiPolygon') {
    let sum = 0;
    for (const poly of coordinates) {
      let a = ringArea(poly[0]);
      for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i]);
      sum += Math.max(a, 0);
    }
    return sum;
  }
  return 0;
}

/* ---------- 已人工录入的区县（这些不覆盖） ---------- */
const curated = new Set();
for (const file of readdirSync(CONTENT_DIR).sort()) {
  if (!file.endsWith('.mjs') || file === 'cities.mjs' || file === BASELINE_FILE) continue;
  const mod = await import(pathToFileURL(join(CONTENT_DIR, file)).href);
  for (const d of mod.districts ?? mod.default ?? []) curated.add(String(d.id));
}
console.log(`· 已人工录入 ${curated.size} 区县（跳过）`);

/* ---------- 城市表 ---------- */
const cityGeo = readJson(join(GEO_DIR, 'cities.geojson'));
const cityById = new Map();
for (const f of cityGeo.features ?? []) {
  cityById.set(String(f.properties.id), {
    name: f.properties.name,
    province: f.properties.province,
  });
}

/* ---------- 逐市生成 ---------- */
const out = [];
const cityMetaExtra = {};
let skipped = 0;
let noName = 0;

for (const file of readdirSync(join(GEO_DIR, 'districts')).sort()) {
  if (!file.endsWith('.geojson')) continue;
  const cityId = file.replace('.geojson', '');
  const city = cityById.get(cityId);
  if (!city) continue;
  const fc = readJson(join(GEO_DIR, 'districts', file));
  const feats = fc.features ?? [];

  let added = 0;
  for (const f of feats) {
    const id = String(f.properties?.id ?? f.properties?.adcode ?? '');
    const name = f.properties?.name ?? '';
    if (!id || !name) {
      noName++;
      continue;
    }
    if (curated.has(id)) {
      skipped++;
      continue;
    }
    const province = f.properties?.province ?? city.province;
    const center = f.properties?.centroid ?? f.properties?.center ?? null;
    const area = geomArea(f.geometry);
    const areaText = area > 0 ? `，面积约 ${Math.round(area)} 平方公里` : '';
    const where = province === city.name ? city.name : `${province}${city.name}`;
    out.push({
      id,
      name,
      city: city.name,
      province,
      oneLiner: `${where}${name}${areaText}。详细人文与景点待补充。`,
      tags: [],
      history: '',
      culture: '',
      people: [],
      features: [],
      specialties: [],
      foods: [],
      spots: [],
      baseline: true,
    });
    added++;
  }

  if (added > 0 && !cityMetaExtra[cityId]) {
    cityMetaExtra[cityId] = {
      intro: `${provinceLabel(city)}下辖 ${feats.length} 个区县。详细城市介绍与美食榜待补充。`,
    };
  }
}

function provinceLabel(city) {
  return city.province === city.name ? city.name : `${city.province}${city.name}`;
}

writeFileSync(
  join(CONTENT_DIR, BASELINE_FILE),
  `/**
 * 【自动生成，请勿手改】由 scripts/gen-baseline-content.mjs 产出。
 * 只含真实行政区信息与由边界算出的面积，人文 / 景点留空待人工精写。
 * 共 ${out.length} 条。
 */
export const districts = ${JSON.stringify(out, null, 2)};
`,
  'utf8',
);

writeFileSync(
  join(CONTENT_DIR, 'auto-city-meta.mjs'),
  `/**
 * 【自动生成，请勿手改】未人工录入城市的最小元信息（仅 intro）。
 * 由 scripts/gen-baseline-content.mjs 产出，共 ${Object.keys(cityMetaExtra).length} 条。
 */
export const cityMeta = ${JSON.stringify(cityMetaExtra, null, 2)};
`,
  'utf8',
);

console.log(`已生成 ${BASELINE_FILE}：${out.length} 条基线条目`);
console.log(`已生成 auto-city-meta.mjs：${Object.keys(cityMetaExtra).length} 条城市 intro`);
console.log(`跳过人工已录入 ${skipped} 条，缺名称 ${noName} 条`);
