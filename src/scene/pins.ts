import * as THREE from 'three';

export interface PinInput {
  id: string;
  name: string;
  districtId: string;
  districtName: string;
  /** 投影后的局部平面坐标 */
  x: number;
  y: number;
  color: number;
  hot: boolean;
  /** 是否属于当前选中区县 */
  active: boolean;
  /** 是否被聚焦（搜索命中 / 卡片打开） */
  focused: boolean;
}

export interface PinRecord {
  id: string;
  districtId: string;
  group: THREE.Group;
  hit: THREE.Mesh;
  dot: THREE.Mesh;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  dotMaterial: THREE.MeshStandardMaterial;
  /** 创建时的基准高度（板块顶面），板块抬升时在此基础上叠加 */
  baseY: number;
  hot: boolean;
  /** 由悬停/聚焦/变暗决定的相对缩放系数（1 为常态） */
  stateScale: number;
  baseOpacity: number;
}

const DOT_GEO = new THREE.SphereGeometry(0.3, 12, 12);
const HALO_GEO = new THREE.RingGeometry(0.4, 0.54, 28);
const HIT_GEO = new THREE.SphereGeometry(0.95, 8, 8);

export function createPin(input: PinInput, baseY: number): PinRecord {
  const group = new THREE.Group();
  group.position.set(input.x, baseY, -input.y);

  const dotMaterial = new THREE.MeshStandardMaterial({
    color: input.color,
    emissive: input.color,
    emissiveIntensity: input.hot ? 1.8 : 1.1,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: 1,
  });
  const dot = new THREE.Mesh(DOT_GEO, dotMaterial);
  dot.position.y = 0.12;
  group.add(dot);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: input.color,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(HALO_GEO, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
  const hit = new THREE.Mesh(HIT_GEO, hitMaterial);
  hit.position.y = 0.12;
  hit.userData = {
    kind: 'pin',
    id: input.id,
    name: input.name,
    districtId: input.districtId,
    districtName: input.districtName,
  };
  group.add(hit);

  const baseScale = input.active ? 1 : 0.72;
  group.scale.setScalar(baseScale);
  group.visible = true;

  return {
    id: input.id,
    districtId: input.districtId,
    group,
    hit,
    dot,
    ring,
    ringMaterial,
    dotMaterial,
    baseY,
    hot: input.hot,
    stateScale: 1,
    baseOpacity: input.active ? 1 : 0.5,
  };
}

export function disposePin(pin: PinRecord): void {
  (pin.dot.material as THREE.Material).dispose();
  pin.ringMaterial.dispose();
  (pin.hit.material as THREE.Material).dispose();
}

export function disposePinGeometries(): void {
  DOT_GEO.dispose();
  HALO_GEO.dispose();
  HIT_GEO.dispose();
}
