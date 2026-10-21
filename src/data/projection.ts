import type { GeoFeature, GeoGeometry, ProjectedShape } from './types';

const EARTH_M_PER_DEG = 111_320; // 米/度（近似）
const WORLD_SIZE = 120; // 归一化后的世界尺寸（scene 单位）

export interface Projection {
  origin: [number, number]; // 中心经纬度
  scale: number;
}

/** 将 GeoJSON 多边形拆为外环坐标（略去岛洞，MVP 只取主轮廓） */
function outerRings(geometry: GeoGeometry): [number, number][][] {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates[0] as [number, number][]];
  }
  return (geometry.coordinates as number[][][][]).map(
    (poly) => poly[0] as [number, number][],
  );
}

/** 由整组要素的包围盒计算统一投影参数（保证区域与区县在同一坐标系） */
export function computeProjection(features: GeoFeature[]): Projection {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    for (const ring of outerRings(f.geometry)) {
      for (const [lng, lat] of ring) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }
  const origin: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  const kx = EARTH_M_PER_DEG * Math.cos((origin[1] * Math.PI) / 180);
  const spanX = (maxLng - minLng) * kx;
  const spanY = (maxLat - minLat) * EARTH_M_PER_DEG;
  return { origin, scale: WORLD_SIZE / Math.max(spanX, spanY) };
}

/** 多边形面积（有向，取绝对值） */
function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** 射线法判断点是否在多边形内 */
function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 面积质心（多边形公式）；顶点质心对凹多边形会落到界外，这里用面积加权 */
function areaCentroid(ring: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    a2 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a2) < 1e-12) {
    // 退化（共线）：退回顶点平均
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/**
 * 求一个保证落在多边形内的点：优先面积质心，若质心落在界外
 * （多岛 / 强凹形状可能出现），在包围盒内网格采样取「离边界最远」的点。
 * 交互拾取、旗子与展签都依赖这个点真正落在版块上。
 */
function pointOnRing(ring: [number, number][]): [number, number] {
  const c = areaCentroid(ring);
  if (pointInRing(c, ring)) return c;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  let best: [number, number] = c;
  let bestScore = -1;
  const STEPS = 24;
  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const pt: [number, number] = [
        minX + ((maxX - minX) * i) / STEPS,
        minY + ((maxY - minY) * j) / STEPS,
      ];
      if (!pointInRing(pt, ring)) continue;
      // 用质心距离做评分：取最靠近几何中心的界内点
      const d = (pt[0] - c[0]) ** 2 + (pt[1] - c[1]) ** 2;
      if (bestScore < 0 || d < bestScore) {
        bestScore = d;
        best = pt;
      }
    }
  }
  return best;
}

/** 按统一投影参数把要素投影为局部平面形状（多环要素合并为一个 shape） */
export function projectFeatures(features: GeoFeature[], p: Projection): ProjectedShape[] {
  const [cx, cy] = p.origin;
  const kx = EARTH_M_PER_DEG * Math.cos((cy * Math.PI) / 180);

  const shapes: ProjectedShape[] = [];
  for (const f of features) {
    // 同一要素的多个外环（海岛 / 飞地）合并为一个 shape：
    // 早期按环拆分会得到多个同 id shape，场景里互相覆盖，
    // 导致只剩最后一个环可交互（上海 / 南京 / 宁波等 9 个多环城市均受影响）。
    const rings = outerRings(f.geometry).map((ring) =>
      ring.map(
        ([lng, lat]) =>
          [(lng - cx) * kx * p.scale, (lat - cy) * EARTH_M_PER_DEG * p.scale] as [number, number],
      ),
    );
    if (rings.length === 0) continue;
    // 主轮廓 = 面积最大的环；交互点 / 基座 / 旗子都以它为准
    let main = rings[0];
    let mainArea = ringArea(main);
    for (const r of rings) {
      const a = ringArea(r);
      if (a > mainArea) {
        main = r;
        mainArea = a;
      }
    }
    shapes.push({
      id: f.id,
      name: f.name,
      province: f.province,
      indexed: f.indexed,
      outline: main,
      outlines: rings,
      centroid: pointOnRing(main),
    });
  }
  return shapes;
}

/** 便捷方法：单次投影（自算投影参数） */
export function projectAll(features: GeoFeature[]): ProjectedShape[] {
  return projectFeatures(features, computeProjection(features));
}

/** 单点投影（景点 pin、天气定位等复用同一坐标系） */
export function projectPoint(lng: number, lat: number, p: Projection): [number, number] {
  const [cx, cy] = p.origin;
  const kx = EARTH_M_PER_DEG * Math.cos((cy * Math.PI) / 180);
  return [(lng - cx) * kx * p.scale, (lat - cy) * EARTH_M_PER_DEG * p.scale];
}