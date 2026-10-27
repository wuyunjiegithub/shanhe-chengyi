import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { projectPoint, type Projection } from '../data/projection';
import type { ProjectedShape } from '../data/types';
import type { TerrainData } from '../data/terrain';

/**
 * 地形图层的世界高度基准。
 * 省份板块由 SceneManager 挤出到 CITY_HEIGHT（顶面在 y = LAND_TOP），
 * 地形直接落在这一层之上：平原几乎贴平，山地按真实海拔拔起。
 * 与 SceneManager 的 CITY_HEIGHT 保持一致（改那边记得同步）。
 */
const LAND_TOP = 2.6;

/**
 * 地形网格的基准面。
 *
 * 不能直接用 LAND_TOP：平原（苏北、上海）高程只有几米，换算成世界坐标不到 0.05，
 * 地形网格与板块顶盖几乎完全共面，远视角下深度精度不够 → 两者反复争夺深度，
 * 整片平原会闪出板块的深蓝底色（用户反馈的「江苏右上角一直闪蓝色背景」）。
 *
 * 抬离 0.08 世界单位（≈600m 画面高度，看不出来）后，任何视角下地形都稳定压住顶盖；
 * 材质上再叠一层 polygonOffset 兜底。板块顶盖本身也被下面的「陆域底板」盖住，
 * 底板用的是地形低地色，所以即使网格在海岸线处有空隙，露出来的也是陆地色而不是蓝色。
 */
const TERRAIN_BASE = LAND_TOP + 0.08;

/** 水面相对所在地形的高差（略高于地表，避免共面 z-fighting；配合材质 polygonOffset） */
const WATER_OFFSET = 0.12;
/** 河道相对所在地形的高差：比湖面再高一点，江河不被湖盖住 */
const RIVER_OFFSET = 0.2;

/**
 * 垂直夸张倍数。
 * 江浙沪皖东西约 900km，映射成 120 世界单位，1 世界单位 ≈ 7.5km；
 * 按真实比例黄山（1864m）只有 0.25 单位，几乎看不见。
 * 夸张 32 倍后主峰约 5.6 单位，明显高出板块（2.6）又不会失真成尖刺，
 * 拉远到省总览也能一眼看出山地起伏（用户反馈「肉眼看不出地形」）。
 * 区县下钻时由 reliefForTop 自动压扁，不会被山体戳穿板块。
 */
const EXAGGERATION = 32;

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
   * 竖向起伏缩放（1 = 真实夸张比例）。
   * 区县视角的板块层固定在 y ≈ 3.6，地形若按满比例会从板块里长出来，
   * 所以下钻时压到 0.12，让地形读作板块下方的「地貌底图」。
   */
  setRelief: (k: number) => void;
  /**
   * 陆域底板：用城市多边形铺一层低地色平面，垫在地形网格之下。
   * 地形是按网格格心是否在陆域内裁剪的，海岸线处必然留一圈半格～一格的空隙，
   * 没有底板时那里会露出板块的深蓝顶盖（读作「背景漏出来」）。
   */
  setLandBase: (shapes: ProjectedShape[]) => void;
  /**
   * 按「给定多边形范围内最高地形」反算一个不会戳穿 topY 的竖向缩放。
   * 区县视角用它保证山体压在区县板块之下。
   */
  reliefForTop: (shapes: ProjectedShape[], topY: number) => number;
  /**
   * 地形表面在世界坐标 (x, z) 处的高度。
   * 城市边界线 / 标记要贴在地形上（否则会被山体埋掉），需要按点取样。
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

  /**
   * 内层分组：所有地形几何都以 TERRAIN_BASE 为基准写死世界高度，
   * 竖向缩放时绕基准面收放（而不是绕 y=0 收缩，否则整层会往海面塌下去）。
   */
  const inner = new THREE.Group();
  group.add(inner);
  let relief = 1;

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

      positions[idx * 3 + 1] = TERRAIN_BASE + h;
      // surfaceY 存「相对基准面的高度」：竖向缩放时只要乘 relief 即可
      surfaceY[idx] = h;
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
  // 对比度加大（0.62 + 0.46·ny → 坡面明度跨约 0.6～1.08），让山地比平原更立体。
  const nrm = meshGeo.attributes.normal.array as Float32Array;
  for (let idx = 0; idx < total; idx++) {
    if (!land[idx]) continue;
    const ny = Math.min(1, Math.max(0, nrm[idx * 3 + 1]));
    const k = 0.62 + 0.46 * ny;
    colors[idx * 3] *= k;
    colors[idx * 3 + 1] *= k;
    colors[idx * 3 + 2] *= k;
  }

  /** 满起伏状态下的顶点色：下钻压扁时往低地色混，弱化「等高带着色块」的观感 */
  const baseColors = new Float32Array(colors);
  const PLAIN_RGB = (() => {
    const c0 = new THREE.Color(ELEV_STOPS[0][1]).multiplyScalar(LIGHT_COMP * 1.1);
    return [c0.r, c0.g, c0.b];
  })();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0.0,
    emissive: 0x0a1f1b,
    emissiveIntensity: 0.22,
    // 深度兜底：平原区地形与板块顶盖高度只差 0.08，远视角下仍可能争深度。
    // polygonOffset 在深度缓冲里再往前拉一点，与到相机距离无关。
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
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
          // 只有放大到能看清山形时才显出来。阈值略放宽（0.02～0.08），
          // 让中等缩放下山形轮廓也能浮现，强化「看得出地形」的观感。
          float fade = 1.0 - smoothstep(0.02, 0.08, w);
          // 海拔恰好为 0 的格子（苏北平原、湖面、DEM 缺测）会让 fract(cb) 恒为 0，
          // 整片区域都被判成「在线条上」，糊成一层发白的雾。
          // 用海拔把 0～6m 的平坦区直接排除，海边和湖面不再泛白。
          float above = smoothstep(2.0, 8.0, vElevM);
          outgoingLight += vec3(0.55, 0.86, 0.78) * line * fade * above * 0.12;
        }
        #include <opaque_fragment>
        `,
      );
  };
  const terrainMesh = new THREE.Mesh(meshGeo, terrainMat);
  terrainMesh.renderOrder = 3;
  // 地形网格挂在外层 group（不参与 inner 的竖向缩放）：
  // 非等比缩放会把法线按 1/relief 放大，压扁后原本几度的缓坡会被放大成侧壁，
  // 整片平原被照成互不相连的大色块。高度变化直接改顶点、重算法线。
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
    // 湖面与湖底地形只差 WATER_OFFSET（0.12）——远视角下这个差值小于深度缓冲精度，
    // 太湖这种「大而平」的湖整片被地形遮住，看起来就是「水干了」。
    // 用面的深度偏移把水面压到地形前面（线宽/几何都不用动）。
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
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
    const waterY = TERRAIN_BASE + lakeElev * vertScale + WATER_OFFSET;
    for (let i = 0; i < vcount; i++) {
      // ShapeGeometry 在 XY 平面，转到世界 XZ（world z = -y，与板块投影一致）
      wPos.push(pa[i * 3], waterY, -pa[i * 3 + 1]);
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
    inner.add(waterMesh);
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
      const e1 = TERRAIN_BASE + Math.max(0, elevAt(lng1, lat1)) * vertScale + RIVER_OFFSET;
      const e2 = TERRAIN_BASE + Math.max(0, elevAt(lng2, lat2)) * vertScale + RIVER_OFFSET;
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
    inner.add(riverMesh);
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
   * 不在网格范围内时退回板块顶面，调用方（城市边界线 / 标记）不会掉到地面以下。
   * 返回值已按当前竖向缩放（relief）换算，与画面里看到的地表一致。
   */
  const [originLng, originLat] = p.origin;
  const kxWorld = EARTH_M_PER_DEG * Math.cos((originLat * Math.PI) / 180) * p.scale;
  const kyWorld = EARTH_M_PER_DEG * p.scale;
  const heightAt = (x: number, z: number): number => {
    const lng = originLng + x / kxWorld;
    const lat = originLat - z / kyWorld;
    const fi = ((lng - minLng) / (maxLng - minLng)) * cols - 0.5;
    const fj = ((maxLat - lat) / (maxLat - minLat)) * rows - 0.5;
    if (fi < -1 || fj < -1 || fi > cols - 1 || fj > rows - 1) return TERRAIN_BASE;
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
    return TERRAIN_BASE + (top + (bot - top) * ty) * relief;
  };

  /** 竖向缩放：绕基准面收放，保证山体压扁后仍贴着陆域顶面 */
  const setRelief = (k: number) => {
    const next = Math.max(0.02, Math.min(4, k));
    if (next === relief) return;
    relief = next;

    // 水面 / 河道是平面，直接缩放分组即可
    inner.scale.y = relief;
    inner.position.y = TERRAIN_BASE * (1 - relief);

    // 地形网格：改顶点高度后重算法线，才能得到「真的变平」的正确光照
    const pos = meshGeo.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < total; i++) arr[i * 3 + 1] = TERRAIN_BASE + surfaceY[i] * relief;
    pos.needsUpdate = true;
    meshGeo.computeVertexNormals();

    // 压扁后山体明暗消失，只剩按海拔分的色块，边界会读成一块块「平铺的色板」。
    // 往低地色混一部分，让地形退回成安静的地貌底图，视觉重心交还给区县板块。
    const mix = Math.min(0.62, (1 - relief) * 0.55);
    const col = meshGeo.attributes.color;
    const ca = col.array as Float32Array;
    for (let i = 0; i < total * 3; i++) {
      ca[i] = baseColors[i] + (PLAIN_RGB[i % 3] - baseColors[i]) * mix;
    }
    col.needsUpdate = true;
  };

  /**
   * 陆域底板：把城市多边形铺成一层低地色平面，垫在地形网格之下。
   * 地形网格按「格心是否在陆域内」裁三角形，海岸线处必然空出半格到一格；
   * 没有底板时那圈空隙露出的是板块顶盖的深蓝发光（用户看到的「蓝色背景一直在闪」）。
   */
  let landBase: THREE.Mesh | null = null;
  const setLandBase = (shapes: ProjectedShape[]) => {
    if (landBase) {
      group.remove(landBase);
      disposeObject(landBase);
      landBase = null;
    }
    if (shapes.length === 0) return;

    const pos: number[] = [];
    const idx: number[] = [];
    let offset = 0;
    for (const s of shapes) {
      const rings = s.outlines && s.outlines.length > 0 ? s.outlines : [s.outline];
      for (const ring of rings) {
        if (ring.length < 3) continue;
        const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
        // Shape 不接受重复的闭合尾点
        const f = pts[0];
        const l = pts[pts.length - 1];
        if (Math.abs(l.x - f.x) < 1e-9 && Math.abs(l.y - f.y) < 1e-9) pts.pop();
        if (pts.length < 3) continue;
        const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
        const pa = geo.attributes.position.array as ArrayLike<number>;
        const ia = geo.index ? (geo.index.array as ArrayLike<number>) : null;
        if (ia) {
          const vcount = pa.length / 3;
          for (let i = 0; i < vcount; i++) pos.push(pa[i * 3], 0, -pa[i * 3 + 1]);
          // ShapeGeometry 在 XY 平面是逆时针（法线 +Z）；映射到 (x, 0, -y) 后
          // 叉积正好朝 +Y，绕序无需反转 —— 反转反而让整块底板被背面剔除，等于没画
          for (let i = 0; i < ia.length; i += 3) {
            idx.push(offset + ia[i], offset + ia[i + 1], offset + ia[i + 2]);
          }
          offset += vcount;
        }
        geo.dispose();
      }
    }
    if (idx.length === 0) return;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

    // 颜色 = 地形最低一档色 × 光照补偿 × 平地坡度系数（1.1），
    // 与地形网格的平原区完全同色，空隙处的拼接几乎看不出来
    const base = new THREE.Color(ELEV_STOPS[0][1]).multiplyScalar(LIGHT_COMP * 1.1);
    const mat = new THREE.MeshStandardMaterial({
      color: base,
      roughness: 0.94,
      metalness: 0.0,
      emissive: 0x0a1f1b,
      emissiveIntensity: 0.22,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    // 略低于地形基准面：底板只负责「补洞」，不该抢地形的高度。
    // 注意挂在 group 而不是 inner 上 —— inner 会做竖向缩放，
    // 一缩放这 0.05 的间隙就被压到 0.006，底板又会和地形抢深度（整片城市形状的色块）。
    mesh.position.y = LAND_TOP + 0.03;
    mesh.renderOrder = 2;
    group.add(mesh);
    landBase = mesh;
    disposables.push(geo, mat);
  };

  /**
   * 按「该市范围内最高地形」反算竖向缩放：
   * 区县板块顶面固定在 topY，地形若按满起伏会从板块里长出来、把区块戳穿。
   * 平坦城市（盐城、上海）算出的缩放会被 1 封顶 —— 周边山川保持真实比例；
   * 山区城市（黄山、杭州）才需要压扁。
   */
  const reliefForTop = (shapes: ProjectedShape[], topY: number): number => {
    const budget = Math.max(0.25, topY - TERRAIN_BASE - 0.12);
    let peak = 0;
    // 先用整座城的包围盒筛掉绝大多数格心，再逐格做点在多边形内判定
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const rings: [number, number][][] = [];
    for (const s of shapes) {
      const rs = s.outlines && s.outlines.length > 0 ? s.outlines : [s.outline];
      for (const r of rs) {
        rings.push(r);
        for (const [x, yN] of r) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          const z = -yN;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
    }
    if (!rings.length) return 1;
    for (let idx = 0; idx < total; idx++) {
      const x = positions[idx * 3];
      const z = positions[idx * 3 + 2];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const h = surfaceY[idx];
      if (h <= peak) continue;
      if (!pointInRings(x, -z, rings)) continue;
      peak = h;
    }
    return peak <= budget ? 1 : Math.max(0.04, budget / peak);
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  };

  return { group, update, setResolution, setRelief, setLandBase, reliefForTop, heightAt, dispose };
}

/** 点是否落在任一外环内（射线法） */
function pointInRings(x: number, y: number, rings: [number, number][][]): boolean {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

/** 释放一個对象及其材质 / 几何（底板重建时用） */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
