import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export interface PlateStyle {
  height: number;
  /** 顶/底盖底色（深色岩盘） */
  capColor: number;
  /** 侧壁底色（更暗，形成「厚度」层次） */
  sideColor: number;
  /** 省份语义色：用于顶盖自发光 */
  glowColor: number;
  /** 边界描边色：与填写色分开，通常用更亮的高对比色，保证区县之间「有线可分」 */
  edgeColor: number;
  /** 基础自发光强度（0~1，选中/悬停时由 SceneManager 临时提高） */
  glowIntensity: number;
  /** 侧壁自发光强度（极淡，避免小岛在俯角下只剩黑刺） */
  sideGlow: number;
  /** 轮廓描边透明度 */
  edgeOpacity: number;
}

export interface PlateMeta {
  kind: 'city' | 'district';
  id: string;
  name: string;
  province?: string;
}

/**
 * ExtrudeGeometry 的材质分组顺序（three r150+，见 geometries/ExtrudeGeometry.js）：
 *   0 = 顶/底盖（buildLidFaces），1 = 侧壁（buildSideFaces）
 * 顺序与直觉相反，务必以此为准，否则会把发光材质加到侧壁上、顶盖变暗。
 */
export const CAP_MATERIAL_INDEX = 0;

/**
 * 顶部轮廓线相对顶盖的抬升量。
 * 板块挤出沿 +Z，旋转 -90° 后 geometry +Z 映射到 world +Y（上）；
 * 把轮廓线抬到顶盖面之上 EDGE_LIFT，可避免与顶盖共面导致的 z-fighting
 * （Phase C 把 DISTRICT_HEIGHT 降到 1.0 后板很薄，共面更明显，边界会闪烁/消失）。
 */
const EDGE_LIFT = 0.02;

/**
 * 顶盖「磨砂」法线噪声。
 * 板块顶面是纯平面，PBR 高光没有起伏可依附，看起来就是一块平涂色卡。
 * 叠一张极细的随机法线后，表面会浮起细密的光泽变化（像磨砂金属/拉丝玻璃）；
 * normalScale 压得很小，只求质感，不破坏区县色块的辨识度。
 */
const MIST_NORMAL_TEXTURE = (() => {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // 中性法线基准 (128,128,255)，xy 各加小幅扰动
    img.data[i * 4] = 112 + Math.random() * 32;
    img.data[i * 4 + 1] = 112 + Math.random() * 32;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.35, 0.35);
  return tex;
})();

/** 边界线像素宽度（Line2 支持真实像素宽度，普通 LineBasicMaterial 的 linewidth 在多数 GPU 上恒为 1px） */
const BORDER_PX = 2.0;

/** 手机端同屏要塞下整块江浙沪皖，2px 的轮廓在小屏上会连成一片、显得又粗又密 */
const BORDER_PX_NARROW = 1.05;

const NARROW_QUERY = '(max-width: 820px)';

/** 窄屏（手机）判定；SSR / 无 matchMedia 时按宽屏处理 */
function isNarrow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/** 由二维闭合环构建挤出板块（侧壁暗、顶盖带语义色微光；Y 轴向上） */
export function createPlateMesh(
  points: [number, number][],
  style: PlateStyle,
  meta: PlateMeta,
): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: style.height, bevelEnabled: false });

  // 顶盖：抛光清漆面。
  // 用 Physical 而非 Standard，是为了 clearcoat —— 底色金属负责漫反射与语义色，
  // 上面再罩一层低粗糙度的清漆，配合 SceneManager 的环境贴图，
  // 板块表面就会随视角流动出一道冷白高光（「有光泽」的来源）。
  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: style.capColor,
    roughness: 0.13,
    metalness: 0.62,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    reflectivity: 0.6,
    envMapIntensity: 1.6,
    normalMap: MIST_NORMAL_TEXTURE,
    normalScale: new THREE.Vector2(0.16, 0.16),
    emissive: style.glowColor,
    emissiveIntensity: style.glowIntensity,
    // 深度往后退一档：地形网格（+0.08）、陆域底板（+0.03）都贴着顶盖铺，
    // 不加偏移时几十米的高差在远视角下抵不过深度精度，会互相穿透成大块色斑。
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  // 边缘 fresnel 冷光：板块顶盖是平面，俯视角下几乎不产生明暗渐变，
  // 只靠环境反射很难看出「光泽」。这里让轮廓附近亮起一圈青蓝辉光，
  // 再交给 bloom 溢出 —— 表面就有了「抛光玻璃边缘」的质感。
  capMaterial.onBeforeCompile = (shader) => {
    // 光带要跨板块连续，单块的 UV 做不出来，得拿世界坐标
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec3 nrm = normalize(normal);
          vec3 vdir = normalize(vViewPosition);

          // ① 边缘 fresnel：轮廓亮起一圈青蓝冷光（抛光玻璃的边）
          float rim = pow(1.0 - clamp(dot(nrm, vdir), 0.0, 1.0), 2.6);
          outgoingLight += vec3(0.30, 0.68, 1.00) * rim * 0.45;

          // ② 正对相机的高光核心：顶面朝向观察者的一半更亮，像被顶灯照着的弧面
          float core = pow(clamp(dot(nrm, vdir), 0.0, 1.0), 3.0);
          outgoingLight += vec3(0.55, 0.72, 0.95) * core * 0.07;

          // ③ 跨板块的斜向柔光带：模拟抛光表面掠过一条灯带
          //    强度刻意压低——手机相机更近，叠太亮会把区县色块冲成白色。
          float band = sin(vWPos.x * 0.065 + vWPos.z * 0.02);
          band = smoothstep(0.62, 1.0, band);
          outgoingLight += vec3(0.50, 0.78, 1.00) * band * 0.11;
        }
        #include <opaque_fragment>
        `,
      );
  };
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: style.sideColor,
    roughness: 0.9,
    metalness: 0.1,
    emissive: style.glowColor,
    emissiveIntensity: style.sideGlow,
  });

  // 材质数组顺序必须与 ExtrudeGeometry 的分组一致：先盖、后壁
  const mesh = new THREE.Mesh(geo, [capMaterial, sideMaterial]);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData = meta;

  // 顶部轮廓：用 Line2（屏幕空间宽线）而非 LineLoop。
  // LineBasicMaterial 的 linewidth 在多数 GPU 上被忽略、恒为 1px，
  // 在同色填充上几乎看不见——这正是用户反馈「区县没有明显线条区分」的根因。
  const positions: number[] = [];
  for (const [x, y] of points) positions.push(x, y, style.height + EDGE_LIFT);
  if (points.length > 0) {
    // 闭合环：首点补到末尾
    positions.push(points[0][0], points[0][1], style.height + EDGE_LIFT);
  }
  const contourGeo = new LineGeometry();
  contourGeo.setPositions(positions);
  const edges = new Line2(
    contourGeo,
    new LineMaterial({
      color: style.edgeColor,
      linewidth: isNarrow() ? BORDER_PX_NARROW : BORDER_PX,
      transparent: true,
      // 手机上同时收窄线宽与不透明度：否则整幅地图的边界会糊成一片网格
      opacity: style.edgeOpacity * (isNarrow() ? 0.66 : 1),
      depthWrite: false,
    }),
  );
  // Line2 的包围球由 InstancedBufferGeometry 推导，容易在斜视角被误剔除；
  // 边界线量级很小，直接关闭视锥剔除最稳。
  edges.frustumCulled = false;
  edges.renderOrder = 2;
  // 记录轮廓高度，供回归脚本校验「线抬离顶盖、不再共面」
  edges.userData.contourZ = style.height + EDGE_LIFT;
  mesh.add(edges);

  // 形状在 XY 平面、挤出沿 +Z；旋转使板块平铺在 XZ 平面、挤出朝 +Y
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
