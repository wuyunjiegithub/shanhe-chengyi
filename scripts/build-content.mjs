/**
 * 内容构建 / 校验脚本
 * 1. 合并 scripts/content/*.mjs 的人工录入内容
 * 2. 与 public/geo 的真实行政区划对齐（校验 id、补齐中心点）
 * 3. 生成 public/content/{cities,districts,spots}.json 供前端 repository 读取
 *
 * 运行：node scripts/build-content.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cityMeta as handCityMeta } from './content/cities.mjs';

const slug = (s) =>
  String(s)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

// 区县码前 4 位即所属地级市；4 个直辖市（京11/津12/沪31/渝50）前 2 位即市本级
const MUNI_PREFIX = new Set(['11', '12', '31', '50']);
const cityIdOfDistrict = (districtId, province) =>
  MUNI_PREFIX.has(districtId.slice(0, 2))
    ? districtId.slice(0, 2) + '0000'
    : districtId.slice(0, 4) + '00';

const ROOT = process.cwd();
const GEO_DIR = join(ROOT, 'public/geo');
const OUT_DIR = join(ROOT, 'public/content');
const TODAY = '2026-10-19';

// ---------- 内容源：自动发现 scripts/content/*.mjs ----------
const CONTENT_DIR = join(ROOT, 'scripts/content');
const sources = [];
for (const file of readdirSync(CONTENT_DIR).sort()) {
  if (!file.endsWith('.mjs') || file === 'cities.mjs') continue;
  const mod = await import(pathToFileURL(join(CONTENT_DIR, file)).href);
  const list = mod.districts ?? mod.default ?? [];
  sources.push(...list);
  console.log(`· 载入 ${file}：${list.length} 区县`);
}

// 自动生成的最小城市元信息：未人工录入的城市也有一条 intro（下辖 N 个区县），
// 人工录入的 cityMeta 优先覆盖它。
let autoCityMeta = {};
try {
  autoCityMeta =
    (await import(pathToFileURL(join(CONTENT_DIR, 'auto-city-meta.mjs')).href)).cityMeta ?? {};
} catch {
  /* 尚未生成基线内容 */
}
const cityMeta = { ...autoCityMeta, ...handCityMeta };

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const cityGeo = readJson(join(GEO_DIR, 'cities.geojson'));

const districtsByCity = new Map();
for (const file of readdirSync(join(GEO_DIR, 'districts'))) {
  if (!file.endsWith('.geojson')) continue;
  const cityId = file.replace('.geojson', '');
  const fc = readJson(join(GEO_DIR, 'districts', file));
  districtsByCity.set(
    cityId,
    (fc.features ?? []).map((f) => ({
      id: String(f.properties.id ?? f.properties.adcode),
      name: f.properties.name,
      province: f.properties.province,
      center: f.properties.centroid ?? f.properties.center ?? null,
      indexed: false,
    })),
  );
}

// ---------- 校验 ----------
const errors = [];
const seenDistrict = new Set();
const seenSpot = new Set();
const contentByDistrict = new Map();

const geoDistrictIds = new Set();
for (const list of districtsByCity.values()) for (const d of list) geoDistrictIds.add(d.id);

for (const d of sources) {
  if (seenDistrict.has(d.id)) errors.push(`区县 id 重复：${d.id} ${d.name}`);
  seenDistrict.add(d.id);
  if (!geoDistrictIds.has(d.id)) errors.push(`区县 ${d.name}(${d.id}) 在 GeoJSON 中不存在`);

  for (const s of d.spots) {
    const [id, name, lng, lat, summary, tags, , suitableFor, duration] = s;
    if (seenSpot.has(id)) errors.push(`景点 id 重复：${id} ${name}`);
    seenSpot.add(id);
    if (!name) errors.push(`景点缺名称：${id}`);
    if (typeof lng !== 'number' || typeof lat !== 'number') errors.push(`景点坐标异常：${id}`);
    if (!summary) errors.push(`景点缺简介：${id}`);
    if (!Array.isArray(tags) || tags.length === 0) errors.push(`景点缺标签：${id}`);
    if (!Array.isArray(suitableFor) || suitableFor.length === 0) errors.push(`景点缺适合人群：${id}`);
    if (!duration) errors.push(`景点缺建议时长：${id}`);
  }
  contentByDistrict.set(d.id, d);
}

// 中心点对齐
for (const d of sources) {
  let center = null;
  for (const list of districtsByCity.values()) {
    const hit = list.find((x) => x.id === d.id);
    if (hit) {
      center = hit.center;
      break;
    }
  }
  d.center = center;
}

if (errors.length) {
  console.error('内容校验失败：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

// ---------- 城市 ----------
const cityFeatureById = new Map(
  (cityGeo.features ?? []).map((f) => [String(f.properties.id), f]),
);

const cities = [];
for (const f of cityGeo.features ?? []) {
  const id = String(f.properties.id);
  const list = districtsByCity.get(id) ?? [];
  const indexed = list.some((d) => contentByDistrict.has(d.id));
  const meta = cityMeta[id] ?? {};
  const foods = (meta.foods ?? []).map(([name, category, recommend, note]) => ({
    name,
    category,
    recommend,
    note,
    image: `/assets/cities/${id}/food-${slug(name)}.jpg`,
  }));
  cities.push({
    id,
    name: f.properties.name,
    province: f.properties.province,
    districts: list.map((d) => d.id),
    indexed,
    intro: indexed ? (cityMeta[id]?.intro ?? '') : '',
    featuredDistricts: list
      .filter((d) => contentByDistrict.has(d.id))
      .slice(0, 3)
      .map((d) => d.id),
    foods: indexed ? foods : [],
    poem: meta.poem ?? '',
    poemFrom: meta.poemFrom ?? '',
    urbanDistricts: meta.urbanDistricts ?? [],
    urbanNote: meta.urbanNote ?? '',
    banner: `/assets/cities/${id}/banner.jpg`,
  });
}

// ---------- 区县 / 景点 ----------
const districts = [];
const spots = [];

for (const d of sources) {
  const [lng, lat] = d.center ?? [0, 0];
  const spotIds = [];
  for (const s of d.spots) {
    const [id, name, slng, slat, summary, tags, hot, suitableFor, duration] = s;
    spotIds.push(id);
    spots.push({
      id,
      name,
      districtId: d.id,
      lng: slng,
      lat: slat,
      summary,
      tags,
      hot: Boolean(hot),
      suitableFor,
      duration,
      source: '公开资料整理 · 待人工复核',
      updatedAt: TODAY,
    });
  }
  districts.push({
    id: d.id,
    name: d.name,
    city: d.city,
    province: d.province,
    oneLiner: d.oneLiner,
    tags: d.tags,
    history: d.history,
    culture: d.culture,
    people: (d.people ?? []).map(([name, note]) => ({ name, note })),
    features: d.features,
    specialties: (d.specialties ?? []).map(([name, kind, note]) => ({ name, kind, note })),
    foods: d.foods.map(([name, category, recommend, note]) => ({
      name,
      category,
      recommend,
      note,
      image: `/assets/cities/${cityIdOfDistrict(d.id, d.province)}/food-${slug(name)}.jpg`,
    })),
    spots: spotIds,
    center: [lng, lat],
    baseline: Boolean(d.baseline),
    source: d.source ?? (d.baseline ? '行政区划基线 · 待人工补充' : '公开资料整理 · 待人工复核'),
    updatedAt: TODAY,
  });
}

// 区县未录入城市：保留 geo 列表但无内容（前端展示灰色板块）
for (const c of cities) {
  if (!c.indexed) continue;
  const missing = (districtsByCity.get(c.id) ?? []).filter((d) => !contentByDistrict.has(d.id));
  if (missing.length) {
    console.log(`· ${c.name} 未录入区县 ${missing.length} 个：${missing.map((d) => d.name).join('、')}`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const write = (name, data) => {
  const p = join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log(`已生成 ${name}：${Array.isArray(data) ? data.length + ' 条' : 'ok'}`);
};

write('cities.json', cities);
write('districts.json', districts);
write('spots.json', spots);

console.log(
  `完成：${cities.length} 市 / ${cities.filter((c) => c.indexed).length} 市已录入 / ${districts.length} 区县 / ${spots.length} 景点`,
);
if (!existsSync(join(OUT_DIR, 'districts.json'))) process.exit(1);
