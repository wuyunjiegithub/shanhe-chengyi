import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { projectPoint, type Projection } from '../data/projection';
import { WATERS, RIVERS, MOUNTAINS } from '../data/terrain';

/**
 * 地形要素的世界高度基准。
 * 省份板块由 SceneManager 挤出到 CITY_HEIGHT（顶面在 y = LAND_TOP），
 * 地形直接落在这一层之上：湖泊/河流贴着顶面，山脉从顶面拔起。
 * 与 SceneManager 的 CITY_HEIGHT 保持一致（改那边记得同步）。
 */
const LAND_TOP = 2.6;
const WATER_Y = LAND_TOP + 0.04; // 略高于板块顶面，避免共面 z-fighting
const RIVER_Y = LAND_TOP + 0.12; // 在湖面之上，江河不被湖盖住
const MOUNTAIN_BASE_Y = LAND_TOP; // 山体基座落在板块顶面

/** 经纬度 → 世界坐标（与板块/旗子/光点同一套：worldX = x, worldZ = -y） */
function toWorld(lng: number, lat: number, p: Projection): [number, number] {
  const [x, y] = projectPoint(lng, lat, p);
  return [x, -y];
}

export interface TerrainHandle {
  group: THREE.Group;
  /** 每帧推进动画（水波 / 河流流动） */
  update: (t: number, dt: number) => void;
  /** 视口尺寸变化：刷新 LineMaterial 的 resolution（Line2 必须，否则宽度错或不可见） */
  setResolution: (w: number, h: number) => void;
  dispose: () => void;
}

/** 构建地形图层（水体 + 江河 + 山脉），返回可挂进场景的句柄 */
export function createTerrain(p: Projection): TerrainHandle {
  const group = new THREE.Group();
  group.name = 'terrain';
  group.renderOrder = 3;

  // ---- 共享资源（便于统一释放） ----
  const disposables: Array<{ dispose: () => void }> = [];
  const riverMats: LineMaterial[] = [];

  // ---- 水体：半透明湖面 + 轻微顶点波动 ----
  const waterU = { value: 0 };
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1d6f8c,
    transparent: true,
    opacity: 0.66,
    roughness: 0.22,
    metalness: 0.12,
    emissive: 0x0b3145,
    emissiveIntensity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterU;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // 世界平面上铺两张错频正弦波，湖面微微起伏（local z → 旋转后 world +Y）
        float _w = sin(transformed.x * 0.7 + uTime * 1.2) * 0.04
                + sin(transformed.y * 1.1 - uTime * 0.9) * 0.04;
        transformed.z += _w;`,
      );
  };
  disposables.push(waterMat);

  for (const w of WATERS) {
    const pts: THREE.Vector2[] = [];
    const SEG = 48;
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const lng = w.lng + Math.cos(a) * w.rx;
      const lat = w.lat + Math.sin(a) * w.ry;
      const [x, ly] = toWorld(lng, lat, p);
      pts.push(new THREE.Vector2(x, ly));
    }
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geo, waterMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = WATER_Y;
    mesh.renderOrder = 3;
    group.add(mesh);
    disposables.push(geo);
  }

  // ---- 江河：发光虚线 + 流动 ----
  const riverMat = new LineMaterial({
    color: 0x4fe3ff,
    linewidth: 2.4,
    transparent: true,
    opacity: 0.92,
    dashed: true,
    dashSize: 1.8,
    gapSize: 1.3,
    depthWrite: false,
  });
  riverMats.push(riverMat);
  disposables.push(riverMat);

  for (const r of RIVERS) {
    const arr: number[] = [];
    for (const [lng, lat] of r.line) {
      const [x, z] = toWorld(lng, lat, p);
      arr.push(x, RIVER_Y, z);
    }
    const geo = new LineGeometry();
    geo.setPositions(arr);
    const line = new Line2(geo, riverMat);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 4;
    group.add(line);
    disposables.push(geo);
  }

  // ---- 山脉：低多边形岩体 + 雪顶 ----
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3c4a3a,
    roughness: 0.96,
    metalness: 0.0,
    emissive: 0x0c1a12,
    emissiveIntensity: 0.4,
    flatShading: true,
  });
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xeef4f8,
    roughness: 0.62,
    metalness: 0.0,
    flatShading: true,
  });
  disposables.push(rockMat, snowMat);

  for (const m of MOUNTAINS) {
    const [x, z] = toWorld(m.lng, m.lat, p);
    const g = new THREE.Group();

    const rockGeo = new THREE.ConeGeometry(m.radius, m.height, 6);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.y = m.height / 2;

    // 雪顶：更小的锥扣在峰尖，约上 1/3
    const snowH = m.height * 0.34;
    const snowGeo = new THREE.ConeGeometry(m.radius * 0.46, snowH, 6);
    const snow = new THREE.Mesh(snowGeo, snowMat);
    snow.position.y = m.height - snowH / 2;

    g.add(rock, snow);
    g.position.set(x, MOUNTAIN_BASE_Y, z);
    g.renderOrder = 3;
    group.add(g);
    disposables.push(rockGeo, snowGeo);
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
    for (const mat of riverMats) {
      mat.resolution.set(w, h);
    }
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    // 逐个 dispose 子对象几何体（部分已在 disposables，这里兜底）
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  };

  return { group, update, setResolution, dispose };
}
