import * as THREE from 'three';

/**
 * 3D 照片空间的空间布局（纯函数，不碰 React / WebGL，便于回归验证）
 * ---------------------------------------------------------------
 * 要求：照片铺满**整个三维空间**，而不是排成一条线 / 一个扁平盘；
 * 相机可以一路拉近钻进照片之间，再拉远看到整片「照片世界」。
 * 做法：分层球壳 + 每层 Fibonacci 球面均匀分布。
 */

export interface HallLayoutOpts {
  /** 触屏设备（手机上照片略大、空间略大） */
  coarse?: boolean;
}

/**
 * 照片世界的整体半径：体积随照片数增长（∝ n^(1/3)），照片越多空间越大、密度稳定。
 * 系数取得比较「空」：照片之间要留出真正的空气，从外面看才是一片有纵深的星海，
 * 而不是一堵贴满照片的墙。
 */
export function worldRadius(n: number, coarse = false): number {
  return Math.min(60, Math.max(coarse ? 12 : 11, 5.6 * Math.cbrt(Math.max(1, n))));
}

/** 一层球壳：半径 + 这层挂几张照片 */
export interface Shell {
  radius: number;
  count: number;
}

/**
 * 均匀球面分布（Fibonacci lattice）：比纯随机更均匀，不会在某一侧堆成一坨。
 */
export function fibonacciSphere(n: number, i: number): THREE.Vector3 {
  const k = i + 0.5;
  const phi = Math.acos(1 - (2 * k) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * k;
  return new THREE.Vector3(
    Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
  );
}

/**
 * 分层球壳：内层球壳表面积小 → 照片少；外层面积大 → 照片多（按 r² 分配）。
 * 于是全空间里「每张照片占多少空」基本一致：拉近不会糊成一片，拉远能看到完整球体。
 */
export function shellLayout(n: number, R: number): Shell[] {
  const K = Math.max(1, Math.min(n, n >= 150 ? 6 : n >= 80 ? 5 : n >= 30 ? 4 : n >= 9 ? 3 : 2));
  const radii: number[] = [];
  for (let s = 0; s < K; s++) {
    // 最内层约 0.28R，最外层 1R：留出球心，相机可以停在中间被照片包围
    radii.push(R * (K === 1 ? 0.72 : 0.28 + 0.72 * (s / (K - 1))));
  }
  const weights = radii.map((r) => r * r);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  // 每层先保底 1 张，剩下的按 r² 权重分配，余数按小数部分从大到小补
  const counts = weights.map(() => 1);
  const rest = n - K;
  if (rest > 0) {
    const shares = weights.map((w) => (w / total) * rest);
    const base = shares.map((s) => Math.floor(s));
    base.forEach((b, j) => (counts[j] += b));
    let left = rest - base.reduce((a, b) => a + b, 0);
    const order = shares
      .map((s, j) => ({ j, frac: s - Math.floor(s) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k].j] += 1;
  }
  return radii.map((radius, j) => ({ radius, count: counts[j] }));
}

/**
 * 球壳上的第 j 个点：Fibonacci 球面分布（均匀、不结块）+ 轻微径向抖动。
 * 每层再绕 Y 轴错开一个角度，相邻两层的照片不会沿同一条半径叠成一摞。
 */
export function shellSpot(shell: Shell, j: number, shellIndex: number): THREE.Vector3 {
  const dir = fibonacciSphere(shell.count, j);
  const a = shellIndex * 0.62;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r = shell.radius * (1 + (Math.random() - 0.5) * 0.06);
  return new THREE.Vector3(
    (dir.x * cos - dir.z * sin) * r,
    dir.y * r,
    (dir.x * sin + dir.z * cos) * r,
  );
}

/** 按顺序把 n 张照片分配到各层球壳，返回每个位置（长度 = shown） */
export function placePhotos(shown: number, R: number): THREE.Vector3[] {
  const shells = shellLayout(Math.max(1, shown), R);
  const spots: THREE.Vector3[] = [];
  let si = 0;
  let sj = 0;
  for (let i = 0; i < shown; i++) {
    while (si < shells.length - 1 && sj >= shells[si].count) {
      si += 1;
      sj = 0;
    }
    spots.push(shellSpot(shells[si], sj, si));
    sj += 1;
  }
  return spots;
}
