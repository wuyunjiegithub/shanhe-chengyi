/**
 * 修复直辖市在 cities.geojson 中的坏几何（中心碎片 → 完整市界）。
 *
 * 问题：fetch-geo 抓到的直辖市（北京/天津/上海/重庆）几何仅覆盖中心城区一小条，
 * 真实行政范围横跨数度。该几何被两处消费：
 *   1) 地形陆域掩膜 loadLandRings() —— 碎片外被判成非陆地 → 地形网格不生成 → 镂空；
 *   2) 总览层城市板块 —— 直辖市只显示中心碎片。
 *
 * 修复：用 public/geo/districts/<id>.geojson（各区县真实几何）的外环做并集，
 * 得到无缝市界替换坏几何；并离线用缓存 DEM 在各自 bbox 内「只补不删」地修复陆域掩膜与高程。
 *
 * 用法：node scripts/fix-municipalities.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const CITIES = path.join(ROOT, 'public/geo/cities.geojson');
const TERRAIN_DIR = path.join(ROOT, 'public/geo/terrain');
const DEM_CACHE = path.join(ROOT, '.cache/terrain');
const ZOOM = 7;

const TARGETS = [
  { id: '110000', name: '北京市' },
  { id: '120000', name: '天津市' },
  { id: '310000', name: '上海市' },
  { id: '500000', name: '重庆市' },
];

// ---- 工具：Douglas-Peucker 简化（闭合环） ----
function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring;
  const pts = ring.slice();
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (Math.hypot(fx - lx, fy - ly) < 1e-9) pts.pop();
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringBBoxOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const p of polys)
    for (const r of p)
      for (const [x, y] of r) {
        if (x < a) a = x;
        if (x > b) b = x;
        if (y < c) c = y;
        if (y > d) d = y;
      }
  return [a, c, b, d];
}

// ---- 地形掩膜公共：读现有 height/mask 与 DEM 采样 ----
const meta = JSON.parse(await fs.readFile(path.join(TERRAIN_DIR, 'height.json'), 'utf8'));
const { bbox, cols, rows, maxElev } = meta;
const heightBuf0 = await fs.readFile(path.join(TERRAIN_DIR, 'height.bin'));
const maskBuf0 = await fs.readFile(path.join(TERRAIN_DIR, 'mask.bin'));
const height = new Float32Array(cols * rows);
for (let i = 0; i < heightBuf0.length; i++) height[i] = (heightBuf0[i] / 255) * maxElev;
const mask = new Uint8Array(maskBuf0);
const scale = maxElev / 255;

const lon2tileX = (lon) => ((lon + 180) / 360) * 2 ** ZOOM;
const lat2tileY = (lat) =>
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
  2 ** ZOOM;
const loaded = new Map();
async function tile(t) {
  if (loaded.has(t)) return loaded.get(t);
  const file = path.join(DEM_CACHE, `dem-${ZOOM}-${t[0]}-${t[1]}.png`);
  let png = null;
  try {
    png = PNG.sync.read(await fs.readFile(file));
  } catch {
    png = null;
  }
  loaded.set(t, png);
  return png;
}
async function sampleDem(lng, lat) {
  const tx = Math.floor(lon2tileX(lng, ZOOM));
  const ty = Math.floor(lat2tileY(lat, ZOOM));
  const png = await tile([tx, ty]);
  if (!png) return 0;
  const fx = (lon2tileX(lng, ZOOM) - tx) * 256;
  const fy = (lat2tileY(lat, ZOOM) - ty) * 256;
  const ix = Math.min(255, Math.max(0, Math.floor(fx - 0.5)));
  const iy = Math.min(255, Math.max(0, Math.floor(fy - 0.5)));
  const i = (iy * 256 + ix) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

// ---- 主流程 ----
const citiesGj = JSON.parse(await fs.readFile(CITIES, 'utf8'));
let pc = null;
try {
  pc = (await import('polygon-clipping')).default;
} catch (e) {
  console.log('· polygon-clipping 不可用，退化为多段并集：', e.message);
}

let totalFilled = 0;
for (const { id, name } of TARGETS) {
  const distFile = path.join(ROOT, 'public/geo/districts', `${id}.geojson`);
  let cj;
  try {
    cj = JSON.parse(await fs.readFile(distFile, 'utf8'));
  } catch {
    console.log(`· 跳过 ${name}（无 ${id}.geojson 全市级文件）`);
    continue;
  }
  const feats = cj.type === 'FeatureCollection' ? cj.features : [cj];
  const TOL = 0.004;
  const districtRings = [];
  for (const f of feats) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      const simp = simplifyRing(poly[0], TOL);
      if (simp.length >= 4) districtRings.push(simp);
    }
  }
  console.log(`· ${name} 区县外环：${districtRings.length} 段，简化后总点 ${districtRings.reduce((s, r) => s + r.length, 0)}`);

  // 真并集（无缝市界）
  let unionCoords;
  if (pc) {
    let acc = null;
    for (const r of districtRings) {
      const poly = [[r]];
      acc = acc === null ? poly : pc.union(acc, poly);
    }
    unionCoords = acc;
  } else {
    unionCoords = districtRings.map((r) => [r]);
  }

  // 包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of unionCoords)
    for (const r of p)
      for (const [x, y] of r) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

  const target = citiesGj.features.find((f) => String(f.properties?.id ?? f.properties?.adcode) === id);
  if (!target) {
    console.log(`· cities.geojson 中找不到 ${id}，跳过`);
    continue;
  }
  const oldBbox = ringBBoxOf(target.geometry);
  target.geometry = { type: 'MultiPolygon', coordinates: unionCoords };
  target.properties.center = [(minX + maxX) / 2, (minY + maxY) / 2];
  console.log(
    `· cities ${name} 几何替换：旧 bbox [${oldBbox.map((v) => v.toFixed(2)).join(', ')}] → 新 [${minX.toFixed(2)}, ${minY.toFixed(2)}, ${maxX.toFixed(2)}, ${maxY.toFixed(2)}]`,
  );

  // 局部补掩膜（只补不删）
  const PAD = 0.05;
  const aLng = minX - PAD, bLng = maxX + PAD, aLat = minY - PAD, bLat = maxY + PAD;
  let filled = 0;
  for (let j = 0; j < rows; j++) {
    const lat = bbox[3] - ((j + 0.5) / rows) * (bbox[3] - bbox[1]);
    for (let i = 0; i < cols; i++) {
      const lng = bbox[0] + ((i + 0.5) / cols) * (bbox[2] - bbox[0]);
      if (lng < aLng || lng > bLng || lat < aLat || lat > bLat) continue;
      const idx = j * cols + i;
      let land = false;
      for (const r of districtRings) {
        if (pointInRing(lng, lat, r)) {
          land = true;
          break;
        }
      }
      if (land && !mask[idx]) {
        let e = await sampleDem(lng, lat);
        if (!Number.isFinite(e) || e < 0) e = 0;
        height[idx] = e;
        mask[idx] = 1;
        filled++;
      }
    }
  }
  totalFilled += filled;
  console.log(`  - 掩膜补陆 ${filled} 格（只补不删）`);
}

await fs.writeFile(CITIES, JSON.stringify(citiesGj));

const outHeight = Buffer.alloc(cols * rows);
const outMask = Buffer.alloc(cols * rows);
for (let i = 0; i < cols * rows; i++) {
  outHeight[i] = Math.max(0, Math.min(255, Math.round(height[i] / (scale || 1))));
  outMask[i] = mask[i];
}
await fs.writeFile(path.join(TERRAIN_DIR, 'height.bin'), outHeight);
await fs.writeFile(path.join(TERRAIN_DIR, 'mask.bin'), outMask);
const newLand = outMask.reduce((a, b) => a + b, 0);
console.log(`· 全部完成：掩膜共补陆 ${totalFilled} 格；当前陆地格 ${newLand} / ${cols * rows}`);
console.log('· 下一步：npm run build → 重编 .so / APK / 桌面，出包。');
