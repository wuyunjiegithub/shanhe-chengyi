import * as THREE from 'three';
import type { WeatherKind } from '../data/types';

/** 一个区域的天气投放参数（世界坐标，由 SceneManager 从板块包围盒算出） */
export interface WeatherRegion {
  id: string;
  kind: WeatherKind;
  /** 板块质心世界 x */
  x: number;
  /** 板块质心世界 z（投影 north 取负） */
  z: number;
  /** 水平半幅：覆盖范围，取板块尺寸的一部分 */
  radius: number;
  /** 粒子柱底部 y：板块顶面往上一点 */
  topY: number;
  /** 粒子柱高度 */
  height: number;
}

const RAIN_COUNT = 300;
const SNOW_COUNT = 240;

interface RegionUser {
  radius: number;
  topY: number;
  height: number;
  x: number;
  z: number;
  isSnow: boolean;
  speeds: Float32Array;
  drift: Float32Array;
}

/**
 * 地图空中的天气层：
 * - 雨 / 雪用 THREE.Points 在对应板块上空做局部粒子场（复用星空那套 Points 套路）；
 * - 晴 / 多云 / 阴 / 雾不画粒子，由 SceneManager 调主光与雾浓度表达（见 setWeatherAmbience）。
 * 只给「当前可见层」投放：省视角 41 城、下钻后该城市约 10~30 区县，开销很小。
 */
export class WeatherFX {
  readonly group = new THREE.Group();
  private systems = new Map<string, THREE.Points>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /**
   * 按区域列表重建 / 更新各区域的降水粒子场。
   * 只有雨 / 雪才画粒子：晴、多云、阴、雾一律不建粒子场（天色氛围由 SceneManager 表达），
   * 否则「阴天也会飘雨丝」——看起来就像永远在下雨。
   */
  setRegions(regions: WeatherRegion[]): void {
    const active = regions.filter((r) => r.kind === 'rain' || r.kind === 'snow');
    const keep = new Set(active.map((r) => r.id));
    for (const [id, pts] of this.systems) {
      if (!keep.has(id)) {
        this.group.remove(pts);
        this.disposePoints(pts);
        this.systems.delete(id);
      }
    }
    for (const r of active) {
      const wantSnow = r.kind === 'snow';
      const existing = this.systems.get(r.id);
      if (existing) {
        // 雨 ↔ 雪 的粒子外观（颜色 / 尺寸 / 速度）不同，切换时重建，
        // 否则「昨晚下雪、现在下雨」会继续飘着昨天的雪花。
        const wasSnow = (existing.geometry.userData as RegionUser).isSnow;
        if (wasSnow === wantSnow) {
          this.applyRegion(existing, r);
          continue;
        }
        this.group.remove(existing);
        this.disposePoints(existing);
        this.systems.delete(r.id);
      }
      const pts = this.createPrecip(r);
      this.systems.set(r.id, pts);
      this.group.add(pts);
    }
  }

  private createPrecip(r: WeatherRegion): THREE.Points {
    const isSnow = r.kind === 'snow';
    const count = isSnow ? SNOW_COUNT : RAIN_COUNT;
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const drift = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = r.x + (Math.random() * 2 - 1) * r.radius;
      positions[i * 3 + 1] = r.topY + Math.random() * r.height;
      positions[i * 3 + 2] = r.z + (Math.random() * 2 - 1) * r.radius;
      speeds[i] = (isSnow ? 1.8 : 7) + Math.random() * (isSnow ? 1.5 : 4);
      drift[i] = (Math.random() * 2 - 1) * (isSnow ? 0.6 : 0.25);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const user: RegionUser = {
      radius: r.radius,
      topY: r.topY,
      height: r.height,
      x: r.x,
      z: r.z,
      isSnow,
      speeds,
      drift,
    };
    geo.userData = user;
    const mat = new THREE.PointsMaterial({
      color: isSnow ? 0xffffff : 0xacd2ff,
      size: isSnow ? 0.14 : 0.09,
      transparent: true,
      opacity: isSnow ? 0.92 : 0.5,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    return pts;
  }

  /** 层级切换后板块坐标会变，按新参数重置粒子分布 */
  private applyRegion(pts: THREE.Points, r: WeatherRegion): void {
    const geo = pts.geometry as THREE.BufferGeometry;
    const user = geo.userData as RegionUser;
    const pos = geo.getAttribute('position').array as Float32Array;
    const count = pos.length / 3;
    user.radius = r.radius;
    user.topY = r.topY;
    user.height = r.height;
    user.x = r.x;
    user.z = r.z;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = r.x + (Math.random() * 2 - 1) * r.radius;
      pos[i * 3 + 1] = r.topY + Math.random() * r.height;
      pos[i * 3 + 2] = r.z + (Math.random() * 2 - 1) * r.radius;
      user.speeds[i] = (user.isSnow ? 1.8 : 7) + Math.random() * (user.isSnow ? 1.5 : 4);
      user.drift[i] = (Math.random() * 2 - 1) * (user.isSnow ? 0.6 : 0.25);
    }
    geo.getAttribute('position').needsUpdate = true;
  }

  update(dt: number): void {
    for (const pts of this.systems.values()) {
      const geo = pts.geometry as THREE.BufferGeometry;
      const user = geo.userData as RegionUser;
      const pos = geo.getAttribute('position').array as Float32Array;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        let y = pos[i * 3 + 1] - user.speeds[i] * dt;
        let x = pos[i * 3] + user.drift[i] * dt;
        if (y < user.topY) {
          y = user.topY + user.height * (0.6 + Math.random() * 0.4);
          x = user.x + (Math.random() * 2 - 1) * user.radius;
        }
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
      }
      geo.getAttribute('position').needsUpdate = true;
    }
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  dispose(): void {
    for (const pts of this.systems.values()) {
      this.group.remove(pts);
      this.disposePoints(pts);
    }
    this.systems.clear();
  }

  private disposePoints(pts: THREE.Points): void {
    pts.geometry.dispose();
    (pts.material as THREE.Material).dispose();
  }
}
