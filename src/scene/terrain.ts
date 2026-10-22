import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { projectPoint, type Projection } from '../data/projection';
import type { TerrainData } from '../data/terrain';

/**
 * 地形图层的世界高度基准。
 * 省份板块由 SceneManager 挤出到 CITY_HEIGHT（顶面在 y = LAND_TOP），
 * 地形直接落在这一层之上：平原几乎贴平，山地按真实海拔拔起。
 * 与 SceneManager 的 CITY_HEIGHT 保持一致（改那边记得同步）。
 */
const LAND_TOP = 2.6;
/** 水面相对所在地形的高差（略高于地表，避免共面 z-fighting） */
const WATER_OFFSET = 0.08;
/** 河道相对所在地形的高差：比湖面再高一点，江河不被湖盖住 */
const RIVER_OFFSET = 0.16;

/**
 * 垂直夸张倍数。
 * 江浙沪皖东西约 900km，映射成 120 世界单位，1 世界单位 ≈ 7.5km；
 * 按真实比例黄山（1864m）只有 0.25 单位，几乎看不见。
 * 夸张 18 倍后主峰约 4.5 单位，明显高出板块（2.6）又不至于失真成尖刺。
 */
const EXAGGERATION = 26;

/**
 * 光照补偿系数。
 * 场景是「深色地图」调性，但打光很亮（半球光 1.3 + 方向光 2.4），
 * 直接把配色的正常亮度交给 PBR 会被放大三四倍、全部溢出成灰白。
 * 基色先压到 0.28 左右，经光照后回到设计想要的中低明度。
 */
const LIGHT_COMP = 0.28;

/** 海拔配色（米 → 颜色）：江浙沪皖以丘陵林地为主，山体保持青绿化，高处才转灰岩 / 雪顶 */
const ELEV_STOPS: Array<[number, number]> = [
  [0, 0x4d6f4e],
  [60, 0x537249],
  [180, 0x5b7a4b],
  [420, 0x66804f],
  [760, 0x748256],
  [1100, 0x8a8a6c],
  [1450, 0xa8a48e],
  [1750, 0xe4ebee],
];

export interface TerrainHandle {
  group: THREE.Group;
  /** 每帧推进动画（水波 / 河流流动） */
  update: (t: number, dt: number) => void;
  /** 视口尺寸变化：刷新 LineMaterial 的 resolution（Line2 必须，否则宽度错或不可见） */
  setResolution: (w: number, h: number) => void;
  dispose: () => void;
}

/** 按海拔查颜色，返回 0-1 的 rgb 三元组 */
function colorAt(elev: number, maxElev: number, out: { r: number; g: number; b: number }): void {
  const e = Math.max(0, Math.min(maxElev, elev));
  let i = 0;
  while (i < ELEV_STOPS.length - 1 && e > ELEV_STOPS[i + 1][0]) i++;
  const [e0, c0] = ELEV_STOPS[i];
  const [e1, c1] = ELEV_STOPS[Math.min(i + 1, ELEV_STOPS.length - 1)];
  const t = e1 > e0 ? Math.max(0, Math.min(1, (e - e0) / (e1 - e0))) : 0;
  const r0 = ((c0 >> 16) & 255) / 255;
  const g0 = ((c0 >> 8) & 255) / 255;
  const b0 = (c0 & 255) / 255;
  const r1 = ((c1 >> 16) & 255) / 255;
  const g1 = ((c1 >> 8) & 255) / 255;
  const b1 = (c1 & 255) / 255;
  out.r = (r0 + (r1 - r0) * t) * LIGHT_COMP;
  out.g = (g0 + (g1 - g0) * t) * LIGHT_COMP;
  out.b = (b0 + (b1 - b0) * t) * LIGHT_COMP;
}

/** 构建地形图层（DEM 地形 + 真实湖岸线 + 真实河道） */
export function createTerrain(p: Projection, data: TerrainData): TerrainHandle {
  const group = new THREE.Group();
  group.name = 'terrain';
  group.renderOrder = 3;

  const disposables: Array<{ dispose: () => void }> = [];
  const { bbox, cols, rows, maxElev } = data.meta;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const total = cols * rows;

  // ---- 1. DEM 地形网格 ----
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const land = new Uint8Array(total);
  const elevs = new Float32Array(total);

  // 先把每个格心的世界坐标 / 海拔都算出来
  for (let j = 0; j < rows; j++) {
    const lat = maxLat - ((j + 0.5) / rows) * (maxLat - minLat);
    for (let i = 0; i < cols; i++) {
      const lng = minLng + ((i + 0.5) / cols) * (maxLng - minLng);
      const idx = j * cols + i;
      const [x, y] = projectPoint(lng, lat, p);
      const e = (data.height[idx] / 255) * maxElev;
      elevs[idx] = e;
      land[idx] = data.mask[idx];
      positions[idx * 3] = x;
      // 高度稍后统一写入（需要看邻居决定边缘衰减）
      positions[idx * 3 + 2] = -y;
    }
  }

  // 垂直缩放：1 米高程 → p.scale * EXAGGERATION 世界单位
  const vertScale = p.scale * EXAGGERATION;

  // DEM 落到 4km 网格后会有细碎锯齿，轻度 3×3 加权平滑让山体连贯（不动大形）
  const W3 = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const smooth = new Float32Array(total);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (!land[idx]) continue;
      let sum = 0;
      let wsum = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nidx = nj * cols + ni;
          if (!land[nidx]) continue;
          const wt = W3[(dj + 1) * 3 + (di + 1)];
          sum += elevs[nidx] * wt;
          wsum += wt;
        }
      }
      smooth[idx] = wsum > 0 ? sum / wsum : elevs[idx];
    }
  }

  const c = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const e = smooth[idx];
      let h = e * vertScale;

      // 陆地边缘做一点高度衰减：否则地形在省界处会突然立起来一堵墙
      if (land[idx]) {
        const edge =
          i === 0 ||
          j === 0 ||
          i === cols - 1 ||
          j === rows - 1 ||
          !land[idx - 1] ||
          !land[idx + 1] ||
          !land[idx - cols] ||
          !land[idx + cols];
        if (edge) h *= 0.72;
      } else {
        h = 0;
      }

      positions[idx * 3 + 1] = LAND_TOP + h;
      colorAt(e, maxElev, c);
      colors[idx * 3] = c.r;
      colors[idx * 3 + 1] = c.g;
      colors[idx * 3 + 2] = c.b;
    }
  }

  // 索引：只有四角都在陆域内的四边形才成面
  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const d = a + cols;
      const e2 = d + 1;
      if (!land[a] || !land[b] || !land[d] || !land[e2]) continue;
      indices.push(a, d, b, b, d, e2);
    }
  }

  const meshGeo = new THREE.BufferGeometry();
  meshGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  meshGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  meshGeo.setIndex(indices);
  meshGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0,
    emissive: 0x0a1611,
    emissiveIntensity: 0.3,
  });
  const terrainMesh = new THREE.Mesh(meshGeo, terrainMat);
  terrainMesh.renderOrder = 3;
  group.add(terrainMesh);
  disposables.push(meshGeo, terrainMat);

  // ---- 2. 水体：真实湖岸线（全部合并成一个 mesh，桌面 / 安卓都只占 1 次绘制） ----
  // 湖面水位不能写死：千岛湖水面 108m、太湖 3m、洪泽湖 13m，
  // 用一个常量会导致高海拔湖泊被自己的地形埋掉。按湖泊所在格的高程单独定水位。
  const elevAt = (lng: number, lat: number): number => {
    const i = Math.min(cols - 1, Math.max(0, Math.floor(((lng - minLng) / (maxLng - minLng)) * cols)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor(((maxLat - lat) / (maxLat - minLat)) * rows)));
    return elevs[j * cols + i];
  };

  const waterU = { value: 0 };
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x0e3542,
    transparent: true,
    opacity: 0.78,
    roughness: 0.22,
    metalness: 0.16,
    emissive: 0x08202c,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // 水面在 XZ 平面，直接沿 +Y 叠两张错频正弦波
        float _w = sin(transformed.x * 0.7 + uTime * 1.2) * 0.05
                + sin(transformed.z * 1.1 - uTime * 0.9) * 0.05;
        transformed.y += _w;`,
      );
  };
  disposables.push(waterMat);

  const wPos: number[] = [];
  const wIdx: number[] = [];
  let wOffset = 0;
  for (const w of data.water) {
    if (w.ring.length < 3) continue;
    const pts: THREE.Vector2[] = [];
    for (const [lng, lat] of w.ring) {
      const [x, y] = projectPoint(lng, lat, p);
      pts.push(new THREE.Vector2(x, y));
    }
    // Three 的 Shape 不接受重复的闭合尾点
    const fx = pts[0].x;
    const fy = pts[0].y;
    const last = pts[pts.length - 1];
    if (Math.abs(last.x - fx) < 1e-9 && Math.abs(last.y - fy) < 1e-9) pts.pop();
    if (pts.length < 3) continue;

    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    const pa = geo.attributes.position.array as ArrayLike<number>;
    const ia = geo.index ? (geo.index.array as ArrayLike<number>) : null;
    if (!ia) {
      geo.dispose();
      continue;
    }
    const vcount = pa.length / 3;
    // 该湖的水位：取岸线环的平均高程（DEM 在湖面上就是水面高程）
    let lngSum = 0;
    let latSum = 0;
    for (const [lng, lat] of w.ring) {
      lngSum += lng;
      latSum += lat;
    }
    const lakeElev = Math.max(0, elevAt(lngSum / w.ring.length, latSum / w.ring.length));
    const surfaceY = LAND_TOP + lakeElev * vertScale + WATER_OFFSET;
    for (let i = 0; i < vcount; i++) {
      // ShapeGeometry 在 XY 平面，转到世界 XZ（world z = -y，与板块投影一致）
      wPos.push(pa[i * 3], surfaceY, -pa[i * 3 + 1]);
    }
    // 从 XY 转到 XZ 会镜像绕序，这里反转一次保证正面朝上
    for (let i = 0; i < ia.length; i += 3) {
      wIdx.push(wOffset + ia[i], wOffset + ia[i + 2], wOffset + ia[i + 1]);
    }
    wOffset += vcount;
    geo.dispose();
  }

  if (wIdx.length > 0) {
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
    waterGeo.setIndex(wIdx);
    // 湖面是平面，法线统一朝上，避免 ShapeGeometry 合并后法线朝向不一
    const normals = new Float32Array(wPos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    waterGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.renderOrder = 4;
    group.add(waterMesh);
    disposables.push(waterGeo);
  }

  // ---- 3. 江河：真实河道走向，合并成一次绘制 ----
  const riverPositions: number[] = [];
  for (const r of data.rivers) {
    for (let i = 1; i < r.line.length; i++) {
      const [lng1, lat1] = r.line[i - 1];
      const [lng2, lat2] = r.line[i];
      const [x1, y1] = projectPoint(lng1, lat1, p);
      const [x2, y2] = projectPoint(lng2, lat2, p);
      // 河道贴着当地地形走：上游（长江皖江段）不沉到地里，下游也不会浮空
      const e1 = LAND_TOP + Math.max(0, elevAt(lng1, lat1)) * vertScale + RIVER_OFFSET;
      const e2 = LAND_TOP + Math.max(0, elevAt(lng2, lat2)) * vertScale + RIVER_OFFSET;
      riverPositions.push(x1, e1, -y1, x2, e2, -y2);
    }
  }

  const riverMats: LineMaterial[] = [];
  if (riverPositions.length >= 6) {
    const riverGeo = new LineSegmentsGeometry();
    riverGeo.setPositions(riverPositions);
    const riverMat = new LineMaterial({
      color: 0x4fe3ff,
      linewidth: 2.0,
      transparent: true,
      opacity: 0.85,
      dashed: true,
      dashSize: 1.6,
      gapSize: 1.2,
      depthWrite: false,
    });
    riverMats.push(riverMat);
    const riverMesh = new LineSegments2(riverGeo, riverMat);
    riverMesh.computeLineDistances();
    riverMesh.frustumCulled = false;
    riverMesh.renderOrder = 5;
    group.add(riverMesh);
    disposables.push(riverGeo, riverMat);
  }

  const update = (t: number, dt: number) => {
    waterU.value = t / 1000;
    // 河流虚线流动：dashOffset 反向推进，像水往下游淌
    const speed = dt * 0.5;
    for (const mat of riverMats) {
      mat.dashOffset = (mat.dashOffset ?? 0) - speed;
    }
  };

  const setResolution = (w: number, h: number) => {
    for (const mat of riverMats) mat.resolution.set(w, h);
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  };

  return { group, update, setResolution, dispose };
}
