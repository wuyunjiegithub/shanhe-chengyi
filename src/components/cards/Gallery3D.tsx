import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { usePhotoLib } from '../../stores/photoLib';
import type { PhotoEntry } from '../../data/photoLibrary';

export interface HallItem {
  key: string;
  title: string;
  sub?: string;
  /** 本地照片库条目（视频 / 动图 / 静态图） */
  photo?: PhotoEntry;
  /** 媒体类型（照片库条目的类型在 photo.kind 里；内置占位图用这个） */
  kind?: 'image' | 'video' | 'animated';
  /** 内置占位资源地址 */
  src?: string;
}

/** 单张照片的基准高度；宽度按真实画幅换算，保证不变形、不被裁 */
const PHOTO_H = 2.9;
const MAX_PHOTOS = 220;

/** 触屏设备：星点更密更亮、机位更广、照片略大——小屏也要有星海的冲击力 */
const IS_MOBILE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 画幅极端时把宽高比夹一下，避免超长全景 / 竖图把画面拉爆 */
function clampAspect(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return 1.5;
  return Math.min(2.8, Math.max(0.45, a));
}

/**
 * 均匀球面分布（Fibonacci lattice）：
 * 比纯随机更均匀，远景星幕不会在某一侧堆成一坨。
 */
function fibonacciSphere(n: number, i: number): THREE.Vector3 {
  const k = i + 0.5;
  const phi = Math.acos(1 - (2 * k) / n);
  const theta = Math.PI * (1 + Math.sqrt(5)) * k;
  return new THREE.Vector3(
    Math.cos(theta) * Math.sin(phi),
    Math.cos(phi),
    Math.sin(theta) * Math.sin(phi),
  );
}

/** 旋臂总圈数随照片数增长，照片多时盘面更大、旋臂更长 */
function armTurns(n: number): number {
  return Math.min(1.9, 1.15 + n / 320);
}

/**
 * 星系盘布局：双旋臂对数螺旋，内密外疏，带一点薄盘厚度与随机抖动。
 * 照片沿旋臂生长，而不是均摊在球面上——这是「星河」感的核心。
 */
function galaxySpot(n: number, i: number, R: number): THREE.Vector3 {
  const t = (i + 0.5) / n;
  const r = R * (0.4 + 0.6 * Math.pow(t, 0.78));
  const arms = n >= 40 ? 2 : 1;
  const armIdx = i % arms;
  const angle =
    t * armTurns(n) * Math.PI * 2 +
    (armIdx * Math.PI * 2) / arms +
    (armIdx === 1 ? 0.38 : 0) + // 第二条臂错开一点，避免机械对称
    (Math.random() - 0.5) * 0.22; // 臂内抖动，别排成数学直线
  const rr = r + (Math.random() - 0.5) * R * 0.05;
  const y = (Math.random() - 0.5) * R * 0.05 * (1.15 - t * 0.55); // 薄盘，内圈略厚
  return new THREE.Vector3(Math.cos(angle) * rr, y, Math.sin(angle) * rr);
}

/** 旋臂引导线采样点（与 galaxySpot 同一条螺旋，只作结构暗示） */
function armPoints(R: number, n: number, armOffset: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s <= 64; s++) {
    const t = s / 64;
    const r = R * (0.4 + 0.6 * Math.pow(t, 0.78));
    const a = t * armTurns(n) * Math.PI * 2 + armOffset;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return pts;
}

/** 径向渐变光斑纹理：星系核心光晕与星云共用（比实体球柔和得多） */
function glowTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [off, color] of stops) grad.addColorStop(off, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Gallery3DProps {
  items: HallItem[];
  /** 父组件控制的聚焦序号（点击照片进入聚焦） */
  focus: number | null;
  onFocus: (index: number | null) => void;
  /** 自动漫游（相机缓慢环绕） */
  touring: boolean;
}

interface PhotoNode {
  group: THREE.Group;
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  backing: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  dir: THREE.Vector3;
  radius: number;
  phase: number;
  bob: number;
  /** 漂浮强度（1 = 正常漂浮，0 = 聚焦冻结） */
  still: number;
  index: number;
}

/**
 * 3D 照片空间：所有照片汇成一条缓缓自转的旋臂星河。
 * - 照片沿双旋臂对数螺旋排布，内密外疏、带薄盘厚度，整盘极慢自转；
 * - 中心是呼吸的核心光晕 + 淡淡的旋臂引导线，盘外缘铺着星云，深处是两层星尘；
 * - 每张照片始终朝向相机（billboard），从任何角度都看得清、不会看到背面；
 * - 拖动环绕 / 滚轮缩放 / 点击照片飞抵近看 / 点空白处退出聚焦。
 */
export function Gallery3D({ items, focus, onFocus, touring }: Gallery3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(0);
  const focusRef = useRef<number | null>(focus);
  focusRef.current = focus;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const shown = Math.min(items.length, MAX_PHOTOS);
    const n = Math.max(shown, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // 移动端 GPU 带宽有限，像素比封顶 1.5，避免大屏手机掉帧
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 2 : 1.5));
    renderer.setSize(mount.clientWidth || 640, mount.clientHeight || 420);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES 色调映射：纯色 MeshBasic 的画面加一层电影感对比——
    // 发光更亮、暗部不死黑，PC 与手机端的「惊艳感」主要靠它
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = IS_MOBILE ? 1.3 : 1.12;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04060c');

    const camera = new THREE.PerspectiveCamera(
      IS_MOBILE ? 58 : 52,
      (mount.clientWidth || 640) / (mount.clientHeight || 420),
      0.1,
      600,
    );

    // 照片云的半径随照片数量增长，保证间距不挤；照片少时收紧，别让画面空荡
    // 手机竖屏水平视野窄，半径下限放大一点，别让旋臂挤成一团
    const R = Math.min(32, Math.max(IS_MOBILE ? 9 : 7.5, 6.5 + 1.45 * Math.sqrt(n)));
    // 星系是扁盘：默认机位放到盘上方斜俯，一眼能看出旋臂结构
    camera.position.set(R * 0.1, R * 1.02, R * 1.6);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.5;
    controls.maxDistance = R * 4.2;
    controls.autoRotateSpeed = 0.55;

    const nodes: PhotoNode[] = [];
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const videoTextures: { texture: THREE.VideoTexture; video: HTMLVideoElement }[] = [];
    const pickables: THREE.Mesh[] = [];

    // ---------- 星系：核心 / 旋臂 / 星云 / 双层星尘 ----------
    // 照片、盘内微尘、旋臂线都挂在这一组下面，整组缓慢自转 = 星系在转
    const galaxy = new THREE.Group();
    scene.add(galaxy);

    // 核心光晕（取代原来的实体小球）：一小一大两层 sprite，呼吸脉动
    // 核心光晕（取代原来的实体小球）：一小一大两层 sprite，呼吸脉动。
    // AdditiveBlending 叠加发光：光晕交叠处自然变亮，是「亮」而不是「灰」
    const coreTex = glowTexture([
      [0, 'rgba(255,255,255,0.95)'],
      [0.16, 'rgba(186,244,255,0.72)'],
      [0.42, 'rgba(64,196,232,0.2)'],
      [1, 'rgba(24,96,150,0)'],
    ]);
    const coreGlowMat = new THREE.SpriteMaterial({
      map: coreTex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreGlow = new THREE.Sprite(coreGlowMat);
    coreGlow.scale.setScalar(R * 0.16);
    galaxy.add(coreGlow);
    const coreHaloMat = new THREE.SpriteMaterial({
      map: coreTex,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreHalo = new THREE.Sprite(coreHaloMat);
    coreHalo.scale.setScalar(R * 0.5);
    galaxy.add(coreHalo);
    disposables.push(coreTex, coreGlowMat, coreHaloMat);

    // 旋臂引导线：照片沿同一条螺旋排布，淡淡的线作为「星系结构」的暗示
    const armOffsets = n >= 40 ? [0, Math.PI + 0.38] : [0];
    const armOpacity = IS_MOBILE ? 0.3 : 0.22;
    for (const off of armOffsets) {
      const geo = new THREE.BufferGeometry().setFromPoints(armPoints(R, n, off));
      const mat = new THREE.LineBasicMaterial({
        color: off === 0 ? 0x22d3ee : 0x8b7bf0,
        transparent: true,
        opacity: armOpacity,
        blending: THREE.AdditiveBlending,
      });
      galaxy.add(new THREE.Line(geo, mat));
      disposables.push(geo, mat);
    }

    // 星云：几团低透明度大光斑铺在盘外缘，给深空做层次（不随盘自转）
    const nebulaTexA = glowTexture([
      [0, 'rgba(139,123,240,0.5)'],
      [0.4, 'rgba(96,84,180,0.15)'],
      [1, 'rgba(40,36,90,0)'],
    ]);
    const nebulaTexB = glowTexture([
      [0, 'rgba(34,211,238,0.42)'],
      [0.4, 'rgba(28,120,150,0.12)'],
      [1, 'rgba(10,50,70,0)'],
    ]);
    // 小屏更浓一点：星云是手机上最省的「氛围面积」
    const nebulaBoost = IS_MOBILE ? 1.5 : 1;
    const nebulaPlacements: { tex: THREE.CanvasTexture; pos: [number, number, number]; scale: number; op: number }[] = [
      { tex: nebulaTexA, pos: [-R * 1.5, R * 0.45, -R * 0.9], scale: R * 1.5, op: 0.5 },
      { tex: nebulaTexB, pos: [R * 1.7, -R * 0.3, R * 1.1], scale: R * 1.2, op: 0.42 },
      { tex: nebulaTexA, pos: [R * 0.4, R * 0.9, -R * 2.0], scale: R * 1.7, op: 0.3 },
    ];
    const nebulas: { mat: THREE.SpriteMaterial; phase: number; baseOp: number }[] = [];
    for (const p of nebulaPlacements) {
      const baseOp = p.op * nebulaBoost;
      const mat = new THREE.SpriteMaterial({
        map: p.tex,
        transparent: true,
        opacity: baseOp,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.position.set(p.pos[0], p.pos[1], p.pos[2]);
      s.scale.setScalar(p.scale);
      scene.add(s);
      nebulas.push({ mat, phase: Math.random() * Math.PI * 2, baseOp });
      disposables.push(mat);
    }
    disposables.push(nebulaTexA, nebulaTexB);

    // 远景星幕：球壳上撒一层细小星点，提供深空纵深；小屏更密更亮
    const starCount = IS_MOBILE ? 1400 : 900;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = fibonacciSphere(starCount, i).multiplyScalar(R * (2.0 + Math.random() * 2.6));
      starPos[i * 3] = v.x;
      starPos[i * 3 + 1] = v.y;
      starPos[i * 3 + 2] = v.z;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xcfe0ff,
      size: IS_MOBILE ? 0.13 : 0.11,
      sizeAttenuation: true,
      transparent: true,
      opacity: IS_MOBILE ? 0.75 : 0.55,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
    disposables.push(starGeo, starMat);

    // 盘内微尘：稀薄的星际物质，跟着星系一起转
    const diskDustCount = IS_MOBILE ? 520 : 380;
    const ddPos = new Float32Array(diskDustCount * 3);
    for (let i = 0; i < diskDustCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = R * (0.4 + Math.random() * 0.75);
      ddPos[i * 3] = Math.cos(a) * rr;
      ddPos[i * 3 + 1] = (Math.random() - 0.5) * R * 0.09;
      ddPos[i * 3 + 2] = Math.sin(a) * rr;
    }
    const ddGeo = new THREE.BufferGeometry();
    ddGeo.setAttribute('position', new THREE.BufferAttribute(ddPos, 3));
    const ddMat = new THREE.PointsMaterial({
      color: 0x9fd8e8,
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: IS_MOBILE ? 0.55 : 0.4,
    });
    const diskDust = new THREE.Points(ddGeo, ddMat);
    galaxy.add(diskDust);
    disposables.push(ddGeo, ddMat);

    // ---------- 照片 ----------

    const backingMat = new THREE.MeshBasicMaterial({ color: 0xe9e2d2, fog: false });
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.0,
      fog: false,
    });
    disposables.push(backingMat, haloMat);

    let done = 0;
    const bump = () => {
      done += 1;
      setLoaded(done);
    };

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    /** 图片到齐后按真实画幅重设画框，绝不裁切、绝不变形 */
    const fitPlane = (node: PhotoNode, aspect: number) => {
      const a = clampAspect(aspect);
      const h = PHOTO_H;
      const w = h * a;
      node.plane.geometry.dispose();
      node.plane.geometry = new THREE.PlaneGeometry(w, h);
      node.backing.geometry.dispose();
      node.backing.geometry = new THREE.PlaneGeometry(w + 0.36, h + 0.36);
      node.halo.geometry.dispose();
      node.halo.geometry = new THREE.PlaneGeometry(w + 0.54, h + 0.54);
    };

    for (let i = 0; i < shown; i++) {
      const item = items[i];
      const spot = galaxySpot(n, i, R);
      const dir = spot.clone().normalize();
      const radius = spot.length();
      const group = new THREE.Group();
      group.position.copy(spot);
      galaxy.add(group);

      const planeMat = new THREE.MeshBasicMaterial({ color: 0x141d2c, fog: false });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(PHOTO_H * 1.5, PHOTO_H), planeMat);
      plane.position.z = 0.02;
      plane.userData.index = i;
      group.add(plane);
      pickables.push(plane);
      disposables.push(planeMat);

      const backing = new THREE.Mesh(
        new THREE.PlaneGeometry(PHOTO_H * 1.5 + 0.36, PHOTO_H + 0.36),
        backingMat,
      );
      group.add(backing);

      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(PHOTO_H * 1.5 + 0.34, PHOTO_H + 0.34),
        haloMat.clone(),
      );
      halo.position.z = -0.02;
      group.add(halo);
      disposables.push(halo.material);

      const node: PhotoNode = {
        group,
        plane,
        backing,
        halo,
        dir,
        radius,
        phase: Math.random() * Math.PI * 2,
        bob: 0.22 + Math.random() * 0.45,
        /** 漂浮强度：聚焦时平滑收敛到 0（细节查看必须稳，不能一直晃） */
        still: 1,
        index: i,
      };
      nodes.push(node);

      // ---------- 异步上画 ----------
      const mediaKind = item.photo?.kind ?? (item.photo ? undefined : item.kind);
      if (mediaKind === 'video' && item.photo) {
        void usePhotoLib.getState().photoUrl(item.photo).then((url) => {
            if (!url) return;
            const video = document.createElement('video');
            video.src = url;
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';
            void video.play().catch(() => undefined);
            const tex = new THREE.VideoTexture(video);
            tex.colorSpace = THREE.SRGBColorSpace;
            videoTextures.push({ texture: tex, video });
            const apply = () => {
              planeMat.map = tex;
              planeMat.color.set(0xffffff);
              planeMat.needsUpdate = true;
              fitPlane(node, (video.videoWidth || 16) / (video.videoHeight || 9));
            };
            if (video.videoWidth) apply();
            else video.addEventListener('loadedmetadata', apply, { once: true });
            bump();
          });
      } else {
        const loadImage = (url: string) => {
          loader.load(
            url,
            (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.anisotropy = 4;
              planeMat.map = tex;
              planeMat.color.set(0xffffff);
              planeMat.needsUpdate = true;
              fitPlane(node, tex.image.width / tex.image.height);
              disposables.push(tex);
              bump();
            },
            undefined,
            () => bump(),
          );
        };
        if (item.src && !item.photo) {
          loadImage(item.src);
        } else if (item.photo) {
          void usePhotoLib.getState().photoUrl(item.photo).then((u) => (u ? loadImage(u) : bump()));
        } else {
          bump();
        }
      }
    }

    // 供自动化回归读取空间内的照片数与相框颜色、漂浮冻结状态
    (window as unknown as Record<string, unknown>).__hall3d = {
      count: nodes.length,
      frameColor: backingMat.color.getHex(),
      stillOf: (i: number) => (nodes[i] ? +nodes[i].still.toFixed(3) : null),
    };

    // ---------- 点击 / 悬浮 ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downXY: [number, number] | null = null;

    const onDown = (e: PointerEvent) => {
      downXY = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (hit) onFocus((hit.object.userData.index as number) ?? null);
      else onFocus(null);
    };
    const onMove = (e: PointerEvent) => {
      // 触屏没有真正的 hover，别在移动端弹提示
      if (e.pointerType === 'touch') return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) {
        setHover(null);
        return;
      }
      const idx = hit.object.userData.index as number;
      const it = items[idx];
      if (!it) {
        setHover(null);
        return;
      }
      setHover({ title: it.title, x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const onLeave = () => setHover(null);

    const dom = renderer.domElement;
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);

    // ---------- 飞抵聚焦 ----------
    let fly: {
      fromPos: THREE.Vector3;
      toPos: THREE.Vector3;
      t: number;
      dur: number;
    } | null = null;
    let lastFocus = focusRef.current;
    const focusTick = () => {
      if (focusRef.current === lastFocus) return;
      lastFocus = focusRef.current;
      if (lastFocus === null || lastFocus >= nodes.length) return;
      const node = nodes[lastFocus];
      // 停在照片外侧一点：沿「盘心 → 照片」方向外推，再从盘上方斜看过去，
      // 避免相机钻进薄薄的盘面里被别的照片挡住
      const to = node.dir
        .clone()
        .multiplyScalar(node.radius + PHOTO_H * 1.9)
        .add(new THREE.Vector3(0, PHOTO_H * 0.95, 0));
      fly = { fromPos: camera.position.clone(), toPos: to, t: 0, dur: 1.0 };
    };

    // ---------- 尺寸 ----------
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    // 弹框是动画展开的，首帧 clientHeight 可能为 0 —— 用 ResizeObserver 兜住
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tmp = new THREE.Vector3();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;

      controls.autoRotate = touring && !fly && focusRef.current === null;
      focusTick();

      if (fly) {
        fly.t = Math.min(1, fly.t + dt / fly.dur);
        camera.position.lerpVectors(fly.fromPos, fly.toPos, easeInOut(fly.t));
        controls.target.lerp(tmp.set(0, 0, 0), 0.12);
        if (fly.t >= 1) fly = null;
      }

      // 漂浮：整组上下浮动（相框与图片同进同退），再让照片正面朝向相机。
      // 聚焦时漂浮平滑收敛到 0——细节查看时照片必须稳住，不能再晃。
      for (const node of nodes) {
        const on = focusRef.current === node.index;
        node.still = Math.min(1, Math.max(0, node.still + (on ? -dt * 2.4 : dt * 2.4)));
        const y = node.dir.y * node.radius + Math.sin(elapsed * 0.55 + node.phase) * node.bob * node.still;
        node.group.position.y = y;
        node.group.lookAt(camera.position);
        const mat = node.halo.material as THREE.MeshBasicMaterial;
        const target = on ? 0.55 : IS_MOBILE ? 0.2 : 0.12;
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 6);
      }
      // 星系动画：整盘极慢自转，核心呼吸，星云明暗浮动
      galaxy.rotation.y += dt * 0.02;
      coreGlow.scale.setScalar(R * 0.16 * (1 + Math.sin(elapsed * 0.9) * 0.07));
      coreGlowMat.opacity = 0.58 + Math.sin(elapsed * 0.9 + 0.6) * 0.16;
      coreHaloMat.opacity = 0.17 + Math.sin(elapsed * 0.55) * 0.07;
      for (const nb of nebulas) {
        nb.mat.opacity = nb.baseOp * (0.82 + Math.sin(elapsed * 0.3 + nb.phase) * 0.18);
      }
      stars.rotation.y -= dt * 0.004;

      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      delete (window as unknown as Record<string, unknown>).__hall3d;
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      for (const v of videoTextures) {
        v.video.pause();
        v.video.src = '';
        v.texture.dispose();
      }
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      // 显式释放 WebGL 上下文，避免与主场景争用导致回退后主上下文丢失而白屏
      renderer.dispose();
      renderer.forceContextLoss?.();
      if (dom.parentElement === mount) dom.remove();
    };
  }, [items, onFocus, touring]);

  return (
    <div className="hall3d" ref={mountRef}>
      {hover && (
        <div className="hall3d-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          {hover.title}
        </div>
      )}
      {items.length > 0 && loaded < Math.min(items.length, MAX_PHOTOS) && (
        <div className="hall3d-loading">
          正在上画 {loaded} / {Math.min(items.length, MAX_PHOTOS)}
        </div>
      )}
    </div>
  );
}
