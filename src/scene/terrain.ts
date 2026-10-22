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

/** 每世界单位对应的米数换算基准（与 projection.ts 保持一致） */
const EARTH_M_PER_DEG = 111_320;

/**
 * 海拔配色（米 → 颜色）。
 * 走「低地冷青绿 → 丘陵黄绿 → 山地暖赭 → 岩灰 → 雪顶」这条冷暖过渡，
 * 只用一个绿色系会让整幅地图糊成一块草地，读不出地势。
 */
const ELEV_STOPS: Array<[number, number]> = [
  [0, 0x2f5a4a],
  [80, 0x376a52],
  [220, 0x46794f],
  [480, 0x638a54],
  [820, 0x86935f],
  [1150, 0xa3986c],
  [1450, 0xbcae8d],
  [1700, 0xccd0c9],
  [1900, 0xf0f6f7],
];

/** 等高线间隔（米）：细刻线只用来读出地势层次，不做测绘含义 */
const CONTOUR_STEP = 220;

export interface TerrainHandle {
  group: THREE.Group;
  /** 每帧推进动画（水波 / 河流流动） */
  update: (t: number, dt: number) => void;
  /** 视口尺寸变化：刷新 LineMaterial 的 resolution（Line2 必须，否则宽度错或不可见） */
  setResolution: (w: number, h: number) => void;
  /**
   * 地形表面在世界坐标 (x, z) 处的高度。
   * 城市边界线要贴在地形上绘制（否则会被山体埋掉），需要按点取样。
   * 落在陆地之外（海面）时返回板块顶面高度。
   */
  heightAt: (x: number, z: number) => number;
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
  /** 平滑后的海拔（米）：顶点色 / 等高线 / 水位取样都用它，避免 DEM 锯齿乱跳 */
  const elevF = new Float32Array(total);
  /** 每个格心的地表世界高度：城市边界线贴地取样 */
  const surfaceY = new Float32Array(total);

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
      surfaceY[idx] = LAND_TOP + h;
      elevF[idx] = e;
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
  // 海拔（米）另存一份属性：等高线在着色器里按它画，不能靠顶点色反推
  meshGeo.setAttribute('elev', new THREE.BufferAttribute(elevF, 1));
  meshGeo.setIndex(indices);
  meshGeo.computeVertexNormals();

  // 坡度明暗：俯视时方向光几乎照不出起伏，按法线 Y 分量再压一档，
  // 陡坡转暗、缓坡留亮，山脊与谷地才有「体积感」而不是一张色卡。
  const nrm = meshGeo.attributes.normal.array as Float32Array;
  for (let idx = 0; idx < total; idx++) {
    if (!land[idx]) continue;
    const ny = Math.min(1, Math.max(0, nrm[idx * 3 + 1]));
    const k = 0.74 + 0.36 * ny;
    colors[idx * 3] *= k;
    colors[idx * 3 + 1] *= k;
    colors[idx * 3 + 2] *= k;
  }

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    emissive: 0x0a1f1b,
    emissiveIntensity: 0.22,
  });
  // 等高线：每 CONTOUR_STEP 米一道极细的冷白刻线。
  // 用 fwidth 让线宽恒为约 1 像素，缩小到省视角时线自然变淡，不会糊成一层网。
  terrainMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float elev;\nvarying float vElevM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvElevM = elev;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vElevM;')
      .replace(
        '#include <opaque_fragment>',
        `
        {
          float cb = vElevM / ${CONTOUR_STEP.toFixed(1)};
          float w = max(fwidth(cb), 1e-5);
          float f = abs(fract(cb + 0.5) - 0.5);
          float line = 1.0 - smoothstep(0.0, w * 0.9, f);
          // 省视角下每像素跨过的等高带太密，线会连成一片白雾 —— 按屏幕导数淡出，
          // 只有放大到能看清山形时才显出来。
          float fade = 1.0 - smoothstep(0.03, 0.11, w);
          outgoingLight += vec3(0.55, 0.86, 0.78) * line * fade * 0.12;
        }
        #include <opaque_fragment>
        `,
      );
  };
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
  /**
   * 水面用「自发光式」材质而不是 PBR：
   * 场景打光很亮（半球光 1.3 + 方向光 2.4）且带环境贴图，PBR 水面朝上时
   * 会被反射成一片灰白，无论怎么调基色都留不住蓝绿。
   * 这张地图是插画调性，水面当「会呼吸的色块」处理即可，直接在着色器里定色。
   */
  const waterMat = new THREE.MeshBasicMaterial({
    color: 0x0b4a5e,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterU;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // 水面在 XZ 平面，叠两张错频正弦波做细浪（local y 就是世界高度）
        float _w = sin(transformed.x * 0.55 + uTime * 1.1) * 0.06
                + sin(transformed.z * 0.9 - uTime * 0.8) * 0.06;
        transformed.y += _w;
        vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;',
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          // 两组缓慢漂移的正弦叠加成「水纹」，只提亮不改变色相，
          // 看上去像湖面上流动的浅滩反光。
          float r1 = sin(vWaterPos.x * 1.35 + vWaterPos.z * 0.55 + uTime * 0.9);
          float r2 = sin(vWaterPos.z * 1.9 - vWaterPos.x * 0.4 - uTime * 0.65);
          float shimmer = pow(max(0.0, r1 * 0.5 + r2 * 0.5), 3.0);
          vec3 wcol = diffuseColor.rgb + vec3(0.11, 0.27, 0.30) * shimmer;
          gl_FragColor = vec4(wcol, diffuseColor.a);
        }
        `,
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

  /**
   * 世界坐标 → 地表高度（双线性插值）。
   * 投影是等距圆柱（线性），可以直接反解经纬度再换算成网格浮点索引；
   * 不在网格范围内时退回板块顶面，调用方（城市边界线）不会掉到地面以下。
   */
  const [originLng, originLat] = p.origin;
  const kxWorld = EARTH_M_PER_DEG * Math.cos((originLat * Math.PI) / 180) * p.scale;
  const kyWorld = EARTH_M_PER_DEG * p.scale;
  const heightAt = (x: number, z: number): number => {
    const lng = originLng + x / kxWorld;
    const lat = originLat - z / kyWorld;
    const fi = ((lng - minLng) / (maxLng - minLng)) * cols - 0.5;
    const fj = ((maxLat - lat) / (maxLat - minLat)) * rows - 0.5;
    if (fi < -1 || fj < -1 || fi > cols - 1 || fj > rows - 1) return LAND_TOP;
    const i0 = Math.max(0, Math.min(cols - 2, Math.floor(fi)));
    const j0 = Math.max(0, Math.min(rows - 2, Math.floor(fj)));
    const tx = Math.max(0, Math.min(1, fi - i0));
    const ty = Math.max(0, Math.min(1, fj - j0));
    const a = surfaceY[j0 * cols + i0];
    const b = surfaceY[j0 * cols + i0 + 1];
    const c2 = surfaceY[(j0 + 1) * cols + i0];
    const d = surfaceY[(j0 + 1) * cols + i0 + 1];
    const top = a + (b - a) * tx;
    const bot = c2 + (d - c2) * tx;
    return top + (bot - top) * ty;
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  };

  return { group, update, setResolution, heightAt, dispose };
}
