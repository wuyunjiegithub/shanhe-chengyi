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

/** 边界线像素宽度（Line2 支持真实像素宽度，普通 LineBasicMaterial 的 linewidth 在多数 GPU 上恒为 1px） */
const BORDER_PX = 2.0;

/** 由二维闭合环构建挤出板块（侧壁暗、顶盖带语义色微光；Y 轴向上） */
export function createPlateMesh(
  points: [number, number][],
  style: PlateStyle,
  meta: PlateMeta,
): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: style.height, bevelEnabled: false });

  const capMaterial = new THREE.MeshStandardMaterial({
    color: style.capColor,
    roughness: 0.38,
    metalness: 0.42,
    emissive: style.glowColor,
    emissiveIntensity: style.glowIntensity,
  });
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
      linewidth: BORDER_PX,
      transparent: true,
      opacity: style.edgeOpacity,
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
