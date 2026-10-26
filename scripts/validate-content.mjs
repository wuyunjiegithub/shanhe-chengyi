#!/usr/bin/env node
/**
 * 内容入库校验：检查 public/content 下三份 JSON 的结构、引用与坐标。
 * 用法：npm run validate（有 error 时退出码 1）
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'public', 'content');

const TAGS = new Set(['古镇', '山水', '博物馆', '寺庙', '亲子', '拍照', '徒步', '历史文化']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

async function readJson(name) {
  return JSON.parse(await readFile(path.join(contentDir, name), 'utf8'));
}

const [cities, districts, spots] = await Promise.all([
  readJson('cities.json'),
  readJson('districts.json'),
  readJson('spots.json'),
]);

if (!Array.isArray(cities) || !Array.isArray(districts) || !Array.isArray(spots)) {
  console.error('✕ cities.json / districts.json / spots.json 顶层必须是数组');
  process.exit(1);
}

/* ---------- 城市 ---------- */
const cityIds = new Set();
for (const c of cities) {
  if (!c.id) err(`城市缺少 id：${c.name ?? '(未命名)'}`);
  if (cityIds.has(c.id)) err(`城市 id 重复：${c.id}`);
  cityIds.add(c.id);
  if (!c.name?.trim()) err(`城市 ${c.id} 缺少名称`);
}

/* ---------- 区县 ---------- */
const districtIds = new Set();
const districtNames = new Map();
for (const d of districts) {
  if (!d.id) err(`区县缺少 id：${d.name ?? '(未命名)'}`);
  if (districtIds.has(d.id)) err(`区县 id 重复：${d.id}`);
  districtIds.add(d.id);
  districtNames.set(d.id, d.name);

  if (!d.name?.trim()) err(`区县 ${d.id} 缺少名称`);
  if (!d.oneLiner?.trim()) err(`区县 ${d.name ?? d.id} 缺少一句话推荐`);
  if (!DATE_RE.test(d.updatedAt ?? '')) err(`区县 ${d.name} updatedAt 格式错误：${d.updatedAt}`);
  // 自动生成的基线条目（baseline）：只有真实行政区信息，人文 / 景点待补。
  // 不要求标签——硬给 2840 个区县编一个白名单标签等于编造数据。
  if (!d.baseline) {
    if (!Array.isArray(d.tags) || d.tags.length === 0) err(`区县 ${d.name} 缺少标签`);
    for (const t of d.tags ?? []) if (!TAGS.has(t)) err(`区县 ${d.name} 含未知标签：${t}`);
  }
  if (!Array.isArray(d.spots)) err(`区县 ${d.name} 的 spots 不是数组`);
  if (!Array.isArray(d.center) || d.center.length !== 2) {
    warn(`区县 ${d.name} 缺少 center，新增景点会落到默认坐标`);
  }
}

/* ---------- 城市 → 区县引用 ----------
 * cities.json 的 districts 是该市完整的行政区划列表（约 300 个），
 * districts.json 只包含已录入内容的子集。因此正确的校验方向是：
 * 每条内容都必须归属某个城市，而不是要求城市列表里的区县都有内容。
 */
const cityByDistrict = new Map();
for (const c of cities) {
  if (!Array.isArray(c.districts)) {
    err(`城市 ${c.name} 的 districts 不是数组`);
    continue;
  }
  if (c.indexed && c.districts.length === 0) warn(`城市 ${c.name} 标记为已录入但没有区县`);
  for (const id of c.districts) {
    if (cityByDistrict.has(id)) warn(`区县 ${id} 同时出现在多个城市的 districts 列表中`);
    cityByDistrict.set(id, c);
  }
}

for (const d of districts) {
  const city = cityByDistrict.get(d.id);
  if (!city) {
    err(`区县 ${d.name}（${d.id}）不在任何城市的 districts 列表中`);
  } else if (city.name !== d.city) {
    warn(`区县 ${d.name} 的 city 字段为「${d.city}」，但归属「${city.name}」`);
  }
}

/* ---------- 景点 ---------- */
const spotIds = new Set();
const spotById = new Map();
for (const s of spots) {
  if (!s.id) err(`景点缺少 id：${s.name ?? '(未命名)'}`);
  if (spotIds.has(s.id)) err(`景点 id 重复：${s.id}`);
  spotIds.add(s.id);
  spotById.set(s.id, s);

  if (!s.name?.trim()) err(`景点 ${s.id} 缺少名称`);
  if (!s.summary?.trim()) err(`景点 ${s.name ?? s.id} 缺少简介`);
  if (!districtIds.has(s.districtId)) err(`景点 ${s.name} 指向不存在的区县 ${s.districtId}`);
  if (!(typeof s.lng === 'number' && s.lng >= 73 && s.lng <= 135.5)) {
    err(`景点 ${s.name} 经度越界：${s.lng}`);
  }
  if (!(typeof s.lat === 'number' && s.lat >= 3 && s.lat <= 54)) {
    err(`景点 ${s.name} 纬度越界：${s.lat}`);
  }
  if (!Array.isArray(s.tags) || s.tags.length === 0) err(`景点 ${s.name} 缺少标签`);
  for (const t of s.tags ?? []) if (!TAGS.has(t)) err(`景点 ${s.name} 含未知标签：${t}`);
  if (!DATE_RE.test(s.updatedAt ?? '')) err(`景点 ${s.name} updatedAt 格式错误：${s.updatedAt}`);
}

/* ---------- 区县 → 景点引用 / 内容块 ---------- */
for (const d of districts) {
  const seen = new Set();
  for (const id of d.spots ?? []) {
    const spot = spotById.get(id);
    if (!spot) {
      err(`区县 ${d.name} 引用了不存在的景点 ${id}`);
      continue;
    }
    if (spot.districtId !== d.id) {
      err(`区县 ${d.name} 引用了属于 ${spot.districtId} 的景点 ${spot.name}`);
    }
    if (seen.has(id)) warn(`区县 ${d.name} 重复引用景点 ${spot.name}`);
    seen.add(id);
  }

  (d.foods ?? []).forEach((f, i) => {
    if (!f.name?.trim()) err(`区县 ${d.name} 第 ${i + 1} 条美食缺少名称`);
  });
  (d.people ?? []).forEach((p, i) => {
    if (!p.name?.trim()) err(`区县 ${d.name} 第 ${i + 1} 位名人缺少姓名`);
  });
}

/* ---------- 未被引用的景点 ---------- */
for (const s of spots) {
  const d = districts.find((x) => x.id === s.districtId);
  if (d && !(d.spots ?? []).includes(s.id)) {
    warn(`景点 ${s.name} 未被所属区县 ${d.name} 引用`);
  }
}

/* ---------- 报告 ---------- */
const indexed = cities.filter((c) => c.indexed).length;
const tagPool = new Set(districts.flatMap((d) => d.tags ?? []));
console.log(
  `内容校验 · ${cities.length} 市（${indexed} 已录入）/ ${districts.length} 区县 / ${spots.length} 景点 / ${tagPool.size} 类标签`,
);

if (warnings.length > 0) {
  console.log(`\n${warnings.length} 条建议：`);
  for (const w of warnings.slice(0, 20)) console.log(`  ! ${w}`);
  if (warnings.length > 20) console.log(`  … 另有 ${warnings.length - 20} 条`);
}

if (errors.length > 0) {
  console.error(`\n${errors.length} 个错误：`);
  for (const e of errors) console.error(`  ✕ ${e}`);
  process.exit(1);
}

console.log('\n✓ 通过（0 个错误）');
