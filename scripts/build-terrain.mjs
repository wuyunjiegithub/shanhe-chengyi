/**
 * 地形数据构建：把「真实地理数据」预处理成随包内置的离线静态资源。
 *
 * 数据来源（均为公开开放数据，构建期抓取一次后永久缓存，运行时零网络请求）：
 * - 高程：AWS Terrain Tiles（Terrarium 编码的 DEM 瓦片，源数据为 SRTM/ASTER/ETOPO）
 *         https://registry.opendata.aws/terrain-tiles/
 * - 水体 / 河道：OpenStreetMap，经 Overpass API 导出（© OpenStreetMap 贡献者，ODbL）
 *
 * 产出（public/geo/terrain/）：
 * - height.json  元数据：bbox / 网格尺寸 / 高程范围
 * - height.bin   高程网格，cols*rows 字节，0-255 线性映射 [0, maxElev]
 * - mask.bin     陆地掩膜，cols*rows 字节，1=在江浙沪皖陆域内，0=海面/省外
 * - water.json   湖库多边形（简化后的真实岸线）
 * - rivers.json  主要河道折线（按真实走向）
 *
 * 用法：node scripts/build-terrain.mjs [--force]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = process.cwd();
const CACHE = path.join(ROOT, '.cache/terrain');
const OUT = path.join(ROOT, 'public/geo/terrain');
const FORCE = process.argv.includes('--force');

/** DEM 瓦片层级：全国范围用 7 级（约 1.1km/px）兼顾体积与主要山脉起伏；
 *  旧版仅江浙沪皖时用的 8 级在此范围内瓦片数会膨胀到 1400+，易因网络抖动失败。 */
const ZOOM = 7;
/** 网格长边格数（世界坐标等比，短边按 bbox 比例推算） */
const GRID_LONG = 240;
/** 面积阈值（km²）：小于此值的池塘/小水库不画，避免几十万个碎面拖垮渲染 */
const MIN_WATER_AREA = 2.0;
/** 河流长度阈值（km）：只保留主干河道 */
const MIN_RIVER_KM = 18;
/** 陆域裁剪后残留片段的最小长度（km）：更短的只是贴边的一点尾巴，画出来反而突兀 */
const MIN_RIVER_RUN_KM = 6;
/**
 * 主要水系白名单：OSM 里一条大河被切成几十段 way，
 * 全量渲染会有几百段线（每段一个绘制对象），既乱又拖性能。
 * 这里只留能撑起「全国地图骨架」的干流（覆盖各大流域）。
 * 同时该名单会被拼成正则，用于约束 Overpass 查询，避免全国 bbox 下一口气拉回所有河流。
 */
const MAJOR_RIVERS = [
  // 长江水系
  '长江', '钱塘江', '富春江', '新安江', '京杭大运河', '淮河', '黄浦江', '瓯江', '青弋江', '甬江',
  '椒江', '飞云江', '秦淮河', '曹娥江', '金华江', '信江', '赣江', '南淝河', '荆江', '清江',
  // 珠江水系
  '珠江', '西江', '北江', '东江', '柳江', '桂江', '郁江', '邕江', '韩江', '鉴江',
  '漠阳江', '南渡江', '元江', '红河', '漓江',
  // 黄河水系
  '黄河', '渭河', '汾河', '洮河', '沁河', '大黑河', '祖厉河',
  // 海河 / 辽河 / 黑龙江水系
  '海河', '辽河', '松花江', '嫩江', '牡丹江', '图们江', '鸭绿江', '乌苏里江', '黑龙江',
  // 西南 / 青藏高原
  '雅鲁藏布江', '澜沧江', '怒江', '金沙江', '通天河', '川江', '大渡河', '雅砻江', '岷江',
  '嘉陵江', '乌江', '沅江', '资水', '澧水', '汉江', '闽江', '汀江',
  // 西北内流
  '塔里木河', '额尔齐斯河', '伊犁河', '疏勒河', '黑河', '玛纳斯河',
];

/** 湖泊 / 水库白名单正则：只取有名字的大水面（湖/水库/错/淀/潭/泊/池/海子/淖），
 * 既约束 Overpass 查询规模，也避免把海量无名小池塘拉回来。 */
const LAKE_RE = '湖|水库|错|淀|潭|泊|池|海子|淖';
/** 多边形简化容差（度）：约 150m，肉眼无损但顶点数大幅下降 */
const SIMPLIFY_TOL = 0.0014;

const EARTH_M_PER_DEG = 111320;
const WORLD_SIZE = 120;

// ---------------------------------------------------------------- 基础工具

const log = (...a) => console.log(...a);

function round(v, n = 5) {
  const k = 10 ** n;
  return Math.round(v * k) / k;
}

/** 射线法：点是否落在环内 */
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

function ringAreaKm2(ring) {
  // 用等距圆柱近似求度²，再换算 km²
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = EARTH_M_PER_DEG * Math.cos((midLat * Math.PI) / 180) / 1000;
  const ky = EARTH_M_PER_DEG / 1000;
  return (Math.abs(a) / 2) * kx * ky;
}

function ringPerimKm(ring) {
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = EARTH_M_PER_DEG * Math.cos((midLat * Math.PI) / 180) / 1000;
  const ky = EARTH_M_PER_DEG / 1000;
  let d = 0;
  for (let i = 1; i < ring.length; i++) {
    d += Math.hypot((ring[i][0] - ring[i - 1][0]) * kx, (ring[i][1] - ring[i - 1][1]) * ky);
  }
  return d;
}

/** Douglas-Peucker 简化（折线） */
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + bx * ay - by * ax) / len;
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
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

/**
 * 闭合环简化。
 * 直接对闭合环跑 DP 会退化成 2 个点：首尾是同一点，两点连线长度为 0，
 * 所有中间点到这条「零长直线」的距离恒为 0，于是全被判为可丢弃。
 * 正确做法是先把环拆成两段（以离首点最远的顶点为断点），分别简化再拼回。
 */
function simplifyRing(ring, tol) {
  if (ring.length < 5) return ring;
  const pts = ring.slice();
  // 去掉重复的闭合尾点
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (Math.hypot(fx - lx, fy - ly) < 1e-9) pts.pop();
  if (pts.length < 4) return pts;

  // 找离首点最远的顶点作为第二个锚点
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  if (far <= 0 || far >= pts.length - 1) return simplify(pts, tol);

  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far), tol);
  const merged = a.concat(b.slice(1));
  return merged.length >= 3 ? merged : pts;
}

// ---------------------------------------------------------------- Web Mercator

const lon2tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

// ---------------------------------------------------------------- 下载

async function download(url, file, { retries = 3 } = {}) {
  try {
    const st = await fs.stat(file);
    if (st.size > 1024) return file;
  } catch {
    /* 未缓存 */
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'shanhe-chengyi/0.9 (offline terrain builder)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, buf);
      return file;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// ---------------------------------------------------------------- DEM 拼图

/** 拼接 bbox 覆盖的所有 DEM 瓦片，返回大图与像素坐标换算信息 */
async function buildDemCanvas(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = Math.floor(lon2tileX(minLng, ZOOM));
  const x1 = Math.floor(lon2tileX(maxLng, ZOOM));
  const y0 = Math.floor(lat2tileY(maxLat, ZOOM));
  const y1 = Math.floor(lat2tileY(minLat, ZOOM));
  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;
  log(`· DEM 瓦片 z${ZOOM}：${nx}×${ny} = ${nx * ny} 张`);

  const W = nx * 256;
  const H = ny * 256;
  const elev = new Float32Array(W * H).fill(0);

  let done = 0;
  const queue = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) queue.push([tx, ty]);

  const CONCURRENCY = 6;
  async function worker() {
    while (queue.length) {
      const [tx, ty] = queue.shift();
      const file = path.join(CACHE, `dem-${ZOOM}-${tx}-${ty}.png`);
      await download(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tx}/${ty}.png`, file);
      const png = PNG.sync.read(await fs.readFile(file));
      const ox = (tx - x0) * 256;
      const oy = (ty - y0) * 256;
      for (let py = 0; py < 256; py++) {
        for (let px = 0; px < 256; px++) {
          const i = (py * png.width + px) * 4;
          // Terrarium 编码：elev = (R * 256 + G + B / 256) - 32768
          const e = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
          elev[(oy + py) * W + ox + px] = e;
        }
      }
      done++;
      if (done % 10 === 0 || done === nx * ny) log(`  下载 / 解码 ${done}/${nx * ny}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { elev, W, H, x0, y0 };
}

/** 在拼图上按经纬度双线性取高程 */
function sampleDem(canvas, lng, lat) {
  const { elev, W, H, x0, y0 } = canvas;
  const fx = (lon2tileX(lng, ZOOM) - x0) * 256;
  const fy = (lat2tileY(lat, ZOOM) - y0) * 256;
  const x = Math.max(0, Math.min(W - 1.001, fx - 0.5));
  const y = Math.max(0, Math.min(H - 1.001, fy - 0.5));
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = x - ix;
  const ty = y - iy;
  const p00 = elev[iy * W + ix];
  const p10 = elev[iy * W + ix + 1];
  const p01 = elev[(iy + 1) * W + ix];
  const p11 = elev[(iy + 1) * W + ix + 1];
  return (
    p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty
  );
}

// ---------------------------------------------------------------- 行政区（陆地掩膜）

async function loadLandRings() {
  const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'public/geo/cities.geojson'), 'utf8'));
  const rings = [];
  for (const f of raw.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) rings.push(poly[0]);
  }
  log(`· 行政区轮廓：${raw.features.length} 市 / ${rings.length} 环`);
  return rings;
}

function inLand(lng, lat, rings) {
  for (const r of rings) {
    // 环包围盒粗筛
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of r) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (pointInRing(lng, lat, r)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- OSM 水体 / 河流

const OVERPASS = 'https://overpass-api.de/api/interpreter';

async function overpass(query, cacheName) {
  const file = path.join(CACHE, cacheName);
  if (!FORCE) {
    try {
      const st = await fs.stat(file);
      if (st.size > 512) {
        log(`  复用缓存 ${cacheName}（${(st.size / 1024 / 1024).toFixed(1)} MB）`);
        return JSON.parse(await fs.readFile(file, 'utf8'));
      }
    } catch {
      /* 无缓存 */
    }
  }
  log(`  Overpass 查询 ${cacheName} …`);
  const body = new URLSearchParams({ data: query });
  let text;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: {
          'User-Agent': 'shanhe-chengyi/0.9 (offline terrain builder)',
          Accept: 'application/json',
        },
        body,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      text = await res.text();
      break;
    } catch (e) {
      if (attempt === 5) throw e;
      log(`    Overpass 第 ${attempt} 次失败（${e.cause?.code || e.message}），2s 后重试…`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(file, text);
  log(`  已缓存 ${cacheName}（${(text.length / 1024 / 1024).toFixed(1)} MB）`);
  return JSON.parse(text);
}

const bboxStr = (b) => `${b[1]},${b[0]},${b[3]},${b[2]}`;

/** 把一组折线按端点接成闭环（relation 的 outer members） */
function stitchRings(lines) {
  const pool = lines.filter((l) => l && l.length > 1).map((l) => l.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let guard = 0;
    while (guard++ < 5000) {
      const head = cur[0];
      const tail = cur[cur.length - 1];
      const closed = Math.hypot(head[0] - tail[0], head[1] - tail[1]) < 1e-7;
      if (closed) break;
      let found = -1;
      let reverse = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const h = l[0];
        const t = l[l.length - 1];
        if (Math.hypot(h[0] - tail[0], h[1] - tail[1]) < 1e-6) {
          found = i;
          break;
        }
        if (Math.hypot(t[0] - tail[0], t[1] - tail[1]) < 1e-6) {
          found = i;
          reverse = true;
          break;
        }
      }
      if (found < 0) break;
      const next = pool.splice(found, 1)[0];
      if (reverse) next.reverse();
      cur = cur.concat(next.slice(1));
    }
    if (cur.length > 3) rings.push(cur);
  }
  return rings;
}

async function buildWater(bbox, landRings) {
  const b = bboxStr(bbox);
  // 只取 lake / reservoir / basin：排除海量的小池塘（pond）。
  // 全国 bbox 下再叠加名称白名单（LAKE_RE），避免一口气拉回所有命名大水面之外的海量要素。
  const query = `[out:json][timeout:180];
(
  way["natural"="water"]["water"~"^(lake|reservoir|basin)$"]["name"~"${LAKE_RE}"](${b});
  relation["natural"="water"]["water"~"^(lake|reservoir|basin)$"]["name"~"${LAKE_RE}"](${b});
);
out geom;`;
  const data = await overpass(query, 'water.json');

  const out = [];
  const stat = { total: data.elements.length, noRing: 0, short: 0, small: 0, thin: 0, ok: 0 };
  for (const el of data.elements) {
    let ring = null;
    if (el.type === 'way' && el.geometry) {
      ring = el.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
    } else if (el.type === 'relation' && el.members) {
      const lines = el.members
        .filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry)
        .map((m) => m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]));
      const rings = stitchRings(lines);
      if (!rings.length) {
        stat.noRing++;
        continue;
      }
      ring = rings.reduce((a, r) => (ringAreaKm2(r) > ringAreaKm2(a) ? r : a), rings[0]);
    }
    if (!ring || ring.length < 4) {
      stat.noRing++;
      continue;
    }
    const area = ringAreaKm2(ring);
    if (area < MIN_WATER_AREA) {
      stat.small++;
      continue;
    }
    // 只要落在江浙沪皖陆域内的水体：bbox 外扩后会带进鄱阳湖、洪泽湖以北的苏北湖泊
    // 等不属于本图的要素，按质心过滤掉，避免地图边缘出现「无主水面」。
    let sx = 0;
    let sy = 0;
    for (const [lng, lat] of ring) {
      sx += lng;
      sy += lat;
    }
    if (!inLand(sx / ring.length, sy / ring.length, landRings)) {
      stat.small++;
      continue;
    }
    const simplified = simplifyRing(ring, SIMPLIFY_TOL).map(([lng, lat]) => [round(lng), round(lat)]);
    if (simplified.length < 3) {
      stat.thin++;
      continue;
    }
    // 再按陆域裁一刀：省界上的界湖（如皖鄂交界的龙感湖、苏鲁交界的石梁河水库）
    // 质心在本省、但有一半伸到省外，不裁就会在板块边缘挂出一块「无主水面」。
    const trimmedRing = simplified.filter(([lng, lat]) => inLand(lng, lat, landRings));
    if (trimmedRing.length < 3) {
      stat.thin++;
      continue;
    }
    const trimmedArea = ringAreaKm2(trimmedRing);
    // 裁完只剩零碎的小角（面积掉到阈值以下）就不画了
    if (trimmedArea < MIN_WATER_AREA * 0.6) {
      stat.small++;
      continue;
    }
    stat.ok++;
    out.push({
      id: `w${out.length}`,
      name: el.tags?.name || '',
      area: Math.round(trimmedArea * 10) / 10,
      ring: trimmedRing,
    });
  }
  out.sort((a, b2) => b2.area - a.area);
  log('  淘汰统计：', JSON.stringify(stat));
  log(`· 水体：${out.length} 个（≥${MIN_WATER_AREA}km²），最大 ${out[0]?.name || '-'} ${out[0]?.area || 0}km²`);
  return out;
}

/**
 * 河道裁剪：只保留落在江浙沪皖陆域内的部分。
 *
 * Overpass 的 bbox 查询只保证「这条 way 与 bbox 有交集」，返回的却是整条 way 的几何，
 * 于是长江上游段会一路画到 114.5°E（本图 bbox 西界 114.83°E），在屏幕左侧悬空跑到图外；
 * 京杭大运河也会越过北界。这里按 ~1.2km 加密后逐段做陆域判定，把连续在陆上的片段取出。
 */
function clipLineToLand(line, landRings, stepKm = 1.2) {
  const midLat = line.reduce((s, p) => s + p[1], 0) / line.length;
  const kx = (EARTH_M_PER_DEG * Math.cos((midLat * Math.PI) / 180)) / 1000;
  const ky = EARTH_M_PER_DEG / 1000;

  // 1) 加密：原 way 顶点间距可达数十公里，不加密断口会歪出去十几公里
  const dense = [];
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    const segKm = Math.hypot((x2 - x1) * kx, (y2 - y1) * ky);
    const n = Math.max(1, Math.ceil(segKm / stepKm));
    for (let k = 0; k < n; k++) dense.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  dense.push(line[line.length - 1]);
  if (dense.length < 2) return [];

  // 2) 逐段判陆：以中点为准，连续在陆上的段落归为一段
  const runs = [];
  let cur = [];
  for (let i = 0; i < dense.length - 1; i++) {
    const a = dense[i];
    const b = dense[i + 1];
    const inside = inLand((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, landRings);
    if (inside) {
      if (!cur.length) cur.push(a);
      cur.push(b);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);

  // 3) 丢掉出界后剩下的零星小段（贴边的一点点尾巴没有意义）
  return runs.filter((r) => r.length >= 2 && ringPerimKm(r) >= MIN_RIVER_RUN_KM);
}

async function buildRivers(bbox, landRings) {
  const b = bboxStr(bbox);
  // 全国 bbox 下若不加名称约束，Overpass 会拉回上百万条河流 way，直接爆内存 / 超时。
  // 这里把 MAJOR_RIVERS 拼成正则，只在查询阶段就只取有名字的干流。
  const RIVER_RE = MAJOR_RIVERS.join('|');
  const query = `[out:json][timeout:180];
(
  way["waterway"="river"]["name"~"${RIVER_RE}"](${b});
  way["waterway"="canal"]["name"~"运河"](${b});
);
out geom;`;
  const data = await overpass(query, 'rivers.json');

  const out = [];
  const stat = { in: 0, clipped: 0, cut: 0, ok: 0 };
  for (const el of data.elements) {
    if (!el.geometry) continue;
    const name = el.tags?.name || '';
    if (!MAJOR_RIVERS.some((k) => name.includes(k))) continue;
    const line = el.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
    if (line.length < 3) continue;
    const km = ringPerimKm(line);
    if (km < MIN_RIVER_KM) continue;
    stat.in++;
    // 先裁到陆域（可能被切成多段：比如长江上游出省后又被切回来）
    const runs = clipLineToLand(line, landRings);
    if (!runs.length) {
      stat.clipped++;
      continue;
    }
    const keptKm = runs.reduce((s, r) => s + ringPerimKm(r), 0);
    if (keptKm < km - 1) stat.cut++;
    for (const run of runs) {
      const simplified = simplify(run, SIMPLIFY_TOL * 1.4).map(([lng, lat]) => [round(lng), round(lat)]);
      // DP 简化会削掉转角，个别顶点又落到边界外几百米，这里再兜一刀
      const trimmed = simplified.filter(([lng, lat]) => inLand(lng, lat, landRings));
      if (trimmed.length < 2) continue;
      stat.ok++;
      out.push({
        id: `r${out.length}`,
        name: el.tags?.name || '',
        km: Math.round(ringPerimKm(trimmed)),
        line: trimmed,
      });
    }
  }
  log(`· 河道裁剪：入选 ${stat.in} 条，其中 ${stat.cut} 条被切短、${stat.clipped} 条整条在图外丢弃`);
  log(`· 河道：${out.length} 段（≥${MIN_RIVER_KM}km）`);
  return out;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  // 1. bbox：取行政区整体范围，外扩一点给海岸线与边缘留白
  const landRings = await loadLandRings();
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of landRings) {
    for (const [lng, lat] of r) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const PAD = 0.05;
  const bbox = [minLng - PAD, minLat - PAD, maxLng + PAD, maxLat + PAD];
  log(`· 范围 ${bbox.map((v) => v.toFixed(3)).join(', ')}`);

  // 2. 网格：按「世界坐标等比」划分，保证地形三角形不被拉扁
  const midLat = (bbox[1] + bbox[3]) / 2;
  const kx = EARTH_M_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const spanXm = (bbox[2] - bbox[0]) * kx;
  const spanYm = (bbox[3] - bbox[1]) * EARTH_M_PER_DEG;
  const cols = spanXm >= spanYm ? GRID_LONG : Math.round((GRID_LONG * spanXm) / spanYm);
  const rows = spanYm >= spanXm ? GRID_LONG : Math.round((GRID_LONG * spanYm) / spanXm);
  log(`· 网格 ${cols}×${rows}（${(spanXm / 1000).toFixed(0)}×${(spanYm / 1000).toFixed(0)} km）`);

  // 3. DEM
  const canvas = await buildDemCanvas(bbox);

  const heights = new Float32Array(cols * rows);
  const mask = new Uint8Array(cols * rows);
  let maxElev = 0;
  for (let j = 0; j < rows; j++) {
    const lat = bbox[3] - ((j + 0.5) / rows) * (bbox[3] - bbox[1]);
    for (let i = 0; i < cols; i++) {
      const lng = bbox[0] + ((i + 0.5) / cols) * (bbox[2] - bbox[0]);
      const idx = j * cols + i;
      const land = inLand(lng, lat, landRings);
      mask[idx] = land ? 1 : 0;
      if (!land) continue;
      let e = sampleDem(canvas, lng, lat);
      if (!Number.isFinite(e) || e < 0) e = 0;
      heights[idx] = e;
      if (e > maxElev) maxElev = e;
    }
  }
  // 抹掉孤立尖刺（DEM 个别异常值），用 3×3 中值近似
  const cleaned = new Float32Array(heights);
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const idx = j * cols + i;
      if (!mask[idx]) continue;
      const nb = [
        heights[idx - 1],
        heights[idx + 1],
        heights[idx - cols],
        heights[idx + cols],
      ].sort((a, b) => a - b);
      const med = (nb[1] + nb[2]) / 2;
      if (heights[idx] > med + 600) cleaned[idx] = med; // 只削异常尖刺，不动真实山峰
    }
  }

  // 4. 量化输出
  const scale = maxElev / 255;
  const heightBuf = Buffer.alloc(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    heightBuf[i] = Math.max(0, Math.min(255, Math.round(cleaned[i] / (scale || 1))));
  }

  await fs.writeFile(
    path.join(OUT, 'height.json'),
    JSON.stringify(
      {
        bbox: bbox.map((v) => round(v, 4)),
        cols,
        rows,
        maxElev: Math.round(maxElev),
        note: '高程：AWS Terrain Tiles (SRTM/ASTER)；水体 / 河道：© OpenStreetMap 贡献者 (ODbL)',
      },
      null,
      0,
    ),
  );
  await fs.writeFile(path.join(OUT, 'height.bin'), heightBuf);
  await fs.writeFile(path.join(OUT, 'mask.bin'), Buffer.from(mask));

  // 5. 水体 / 河流
  const water = await buildWater(bbox, landRings);
  const rivers = await buildRivers(bbox, landRings);
  await fs.writeFile(path.join(OUT, 'water.json'), JSON.stringify(water));
  await fs.writeFile(path.join(OUT, 'rivers.json'), JSON.stringify(rivers));

  const sizeOf = async (f) => (await fs.stat(path.join(OUT, f))).size;
  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  log('· 输出：');
  for (const f of ['height.json', 'height.bin', 'mask.bin', 'water.json', 'rivers.json']) {
    log(`  ${f.padEnd(13)} ${kb(await sizeOf(f))}`);
  }
  log(`· 最高点 ${Math.round(maxElev)}m，陆地格 ${mask.reduce((a, b) => a + b, 0)} 个`);
}

main().catch((e) => {
  console.error('构建地形失败：', e);
  process.exit(1);
});
