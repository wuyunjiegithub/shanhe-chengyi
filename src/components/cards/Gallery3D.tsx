import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { usePhotoLib } from '../../stores/photoLib';
import type { PhotoEntry } from '../../data/photoLibrary';
import { fibonacciSphere, placePhotos, shellLayout, worldRadius } from './hallLayout';

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

/** 单张照片的基准高度；宽度按真实画幅换算，保证不变形、不被裁。
 *  比照片间距小一截——留白是「星海」而不是「照片墙」的关键。 */
const PHOTO_H = 2.4;
/** 聚焦时照片放大的倍数 */
const FOCUS_SCALE = 2.2;
/** 聚焦照片停在相机正前方的固定距离：无论星系大小，呈现大小恒定、居中 */
const FOCUS_DIST = 9;
const MAX_PHOTOS = 220;

/** 触屏设备：星点更密更亮、机位更广、照片略大——小屏也要有星海的冲击力 */
const IS_MOBILE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/** 画幅极端时把宽高比夹一下，避免超长全景 / 竖图把画面拉爆 */
function clampAspect(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return 1.5;
  return Math.min(2.8, Math.max(0.45, a));
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
  /** 聚焦混合（0 = 在旋臂原位，1 = 飞抵中央展示） */
  focus: number;
  index: number;
  /** 这张照片的可取地址（聚焦时用它补一版高清纹理） */
  url?: string;
  /** 是否已经是高清纹理 */
  hd?: boolean;
}

/**
 * 3D 照片空间：所有照片散布在一整个立体「照片世界」里，可以一路拉近钻进去、再拉远看全貌。
 * - 照片按分层球壳铺满三维空间（内层少、外层多，面密度一致），不是排成一条线或一个平面；
 * - 整片缓缓自转，中心一团呼吸光晕，四周撒着星云与星尘，远近有雾做纵深；
 * - 每张照片始终朝向相机（billboard），从任何角度都看得清、不会看到背面；
 * - 拖动环绕 / 滚轮缩放 / 点击照片飞抵近看 / 点空白处退出聚焦。
 */
export function Gallery3D({ items, focus, onFocus, touring }: Gallery3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(0);
  const focusRef = useRef<number | null>(focus);
  focusRef.current = focus;
  // 自动漫游开关走 ref：如果放进下面 effect 的依赖里，每点一次「漫游」都会
  // 重建整个 WebGL 场景 + 重载全部照片纹理（220 张），表现为闪一下再重新上画。
  const touringRef = useRef(touring);
  touringRef.current = touring;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // 上画是异步的（VideoTexture / TextureLoader）：若在卸载之后才回调，
    // 创建出的 video 与 texture 就再也进不了清理列表，变成常驻的孤儿资源。
    let alive = true;

    const shown = Math.min(items.length, MAX_PHOTOS);
    const n = Math.max(shown, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // 移动端 GPU 带宽有限，像素比封顶 1.5（与主场景 SceneManager 的 coarse ? 1.5 : 2 一致）。
    // 这里曾经写反成移动端 2、桌面 1.5：手机上按 2×DPR 渲染，像素量比主场景还高，
    // 双 WebGL 上下文并存时最先触发上下文回收；桌面画质反而被无谓压低。
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.5 : 2));
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

    // 照片世界的半径随照片数增长：照片越多空间越大，密度基本恒定
    const R = worldRadius(n, IS_MOBILE);
    // 默认机位：站在照片世界外面一点（R + 9）斜上方——最近的一圈照片还有一段距离，
    // 不会一张就糊满屏；远处的层层沉进深空。滚轮拉近钻进去、拉远看整片世界。
    camera.position
      .copy(new THREE.Vector3(0.18, 0.3, 1).normalize().multiplyScalar(R + 9));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.2;
    controls.maxDistance = R * 2.8;
    controls.autoRotateSpeed = 0.45;

    // 远景雾：越远的照片越暗、渐渐融进深空，形成真实的纵深层次，
    // 而不是把上百张照片糊成一堵亮度相同的墙。密度随相机距离动态调，
    // 拉远看全貌时整片照片仍然都看得见（见 tick）。
    scene.fog = new THREE.FogExp2(0x04060c, 0.02);

    const nodes: PhotoNode[] = [];
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const videoTextures: { texture: THREE.VideoTexture; video: HTMLVideoElement }[] = [];
    const pickables: THREE.Mesh[] = [];

    // ---------- 空间氛围：核心光 / 星云 / 星尘 ----------
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
    coreGlow.scale.setScalar(R * 0.11);
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

    // 旋臂引导线已去掉：照片不再沿螺旋排成一条「线」，而是铺满整个球体空间，
    // 再画引导线反而会把视线的注意力拉回一个平面上。

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
      { tex: nebulaTexA, pos: [-R * 1.4, R * 0.9, -R * 0.9], scale: R * 1.5, op: 0.5 },
      { tex: nebulaTexB, pos: [R * 1.6, -R * 0.7, R * 1.0], scale: R * 1.2, op: 0.42 },
      { tex: nebulaTexA, pos: [R * 0.4, R * 1.5, -R * 1.8], scale: R * 1.7, op: 0.3 },
      { tex: nebulaTexB, pos: [-R * 0.6, -R * 1.4, R * 1.5], scale: R * 1.4, op: 0.26 },
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
        // 星云不吃雾：远景雾只用来做「照片的纵深」，别把背景氛围也一起压暗
        fog: false,
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
      fog: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
    disposables.push(starGeo, starMat);

    // 空间微尘：稀薄的星际物质填满整个球体（不再是薄薄一层盘），
    // 相机钻进去时前后左右都有浮尘，纵深感和「身处其中」的感觉主要靠它
    const dustCount = IS_MOBILE ? 640 : 460;
    const ddPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const v = fibonacciSphere(dustCount, i);
      // 半径按 cbrt 采样 = 体积均匀，不会全挤在球心
      const rr = R * (0.1 + 0.92 * Math.cbrt(Math.random()));
      ddPos[i * 3] = v.x * rr;
      ddPos[i * 3 + 1] = v.y * rr;
      ddPos[i * 3 + 2] = v.z * rr;
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

    // 边框用接近星空底的深蓝，不再用刺眼的米白；厚度也收窄，只留一圈细边。
    // 注意这里**不关 fog**：远处的照片要随雾一起沉进深空，才有纵深。
    const backingMat = new THREE.MeshBasicMaterial({ color: 0x1a2436, transparent: true });
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

    /**
     * ---------- 渐进式上画 ----------
     * 以前是把 items 里每张图同时 `TextureLoader.load(url)`：220 张原图一起
     * 解码（手机上是 2000~4000px 的 JPEG）+ 一起上传显存，解码线程被占满、
     * 显存暴涨，弹层打开就直接卡死甚至丢 WebGL 上下文。
     * 现在三件事：
     * 1) 限量并发（手机上 3、桌面 4），排队的图慢慢上，界面立刻可用；
     * 2) 先缩成小纹理再上传（星系里一张照片在屏幕上就一两百像素，
     *    512 边长足够；手机 384），显存占用降到原来的几十分之一；
     * 3) 用户点开放大看的那张，再单独补一版高清（见 tick 里的 hd 逻辑）。
     */
    const TEX_MAX = IS_MOBILE ? 384 : 512;
    const TEX_MAX_HD = IS_MOBILE ? 1024 : 1536;
    const CONCURRENCY = IS_MOBILE ? 3 : 4;

    /** 把 <img> 画进缩略画布并生成纹理：返回纹理与原始画幅 */
    const rasterize = (img: HTMLImageElement, maxEdge: number) => {
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (!nw || !nh) return null;
      const k = Math.min(1, maxEdge / Math.max(nw, nh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(nw * k));
      c.height = Math.max(1, Math.round(nh * k));
      const g = c.getContext('2d');
      if (!g) return null;
      g.drawImage(img, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      return { tex, aspect: nw / nh };
    };

    const loadImg = (url: string) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });

    /** 换纹理：顺手把旧纹理还给显存 */
    const applyTexture = (node: PhotoNode, tex: THREE.Texture, aspect: number) => {
      const mat = node.plane.material as THREE.MeshBasicMaterial;
      const old = mat.map;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      fitPlane(node, aspect);
      if (old && old !== tex) {
        const i = disposables.indexOf(old);
        if (i >= 0) disposables.splice(i, 1);
        old.dispose();
      }
      disposables.push(tex);
    };

    const queue: (() => Promise<void>)[] = [];
    let running = 0;
    const pump = () => {
      if (!alive) return;
      while (running < CONCURRENCY && queue.length > 0) {
        const task = queue.shift() as () => Promise<void>;
        running += 1;
        void task()
          .catch(() => undefined)
          .then(() => {
            running -= 1;
            pump();
          });
      }
    };

    /** 图片到齐后按真实画幅重设画框，绝不裁切、绝不变形 */
    const fitPlane = (node: PhotoNode, aspect: number) => {
      const a = clampAspect(aspect);
      const h = PHOTO_H;
      const w = h * a;
      node.plane.geometry.dispose();
      node.plane.geometry = new THREE.PlaneGeometry(w, h);
      node.backing.geometry.dispose();
      node.backing.geometry = new THREE.PlaneGeometry(w + 0.2, h + 0.2);
      node.halo.geometry.dispose();
      node.halo.geometry = new THREE.PlaneGeometry(w + 0.34, h + 0.34);
    };

    /* ---------- 把照片分到各层球壳上：铺满整个三维空间 ---------- */
    const spots = placePhotos(shown, R);

    for (let i = 0; i < shown; i++) {
      const item = items[i];
      const spot = spots[i];
      const dir = spot.clone().normalize();
      const radius = spot.length();
      const group = new THREE.Group();
      group.position.copy(spot);
      galaxy.add(group);

      const planeMat = new THREE.MeshBasicMaterial({ color: 0x141d2c, transparent: true });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(PHOTO_H * 1.5, PHOTO_H), planeMat);
      plane.position.z = 0.02;
      plane.userData.index = i;
      group.add(plane);
      pickables.push(plane);
      disposables.push(planeMat);

      const backing = new THREE.Mesh(
        new THREE.PlaneGeometry(PHOTO_H * 1.5 + 0.2, PHOTO_H + 0.2),
        backingMat.clone(),
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
        /** 聚焦混合（0 = 在旋臂原位，1 = 飞抵中央展示） */
        focus: 0,
        index: i,
      };
      nodes.push(node);

      // ---------- 排队上画（限量并发，见上面的 TEX_MAX / CONCURRENCY） ----------
      const mediaKind = item.photo?.kind ?? (item.photo ? undefined : item.kind);
      if (mediaKind === 'video' && item.photo) {
        const photo = item.photo;
        queue.push(async () => {
          const url = await usePhotoLib.getState().photoUrl(photo);
          if (!url || !alive) {
            bump();
            return;
          }
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
          node.url = url;
          node.hd = true; // 视频按原分辨率播放，不再走高清补帧
          const apply = () => {
            applyTexture(node, tex, (video.videoWidth || 16) / (video.videoHeight || 9));
            bump();
          };
          if (video.videoWidth) apply();
          else video.addEventListener('loadedmetadata', apply, { once: true });
        });
      } else {
        const paint = async (url: string) => {
          const img = await loadImg(url);
          if (!alive) return;
          const painted = img ? rasterize(img, TEX_MAX) : null;
          // 已经补过高清就别再被低清盖回去（队列慢、用户先点开了这张）
          if (painted && !node.hd) applyTexture(node, painted.tex, painted.aspect);
          bump();
        };
        if (item.src && !item.photo) {
          node.url = item.src;
          queue.push(() => paint(item.src as string));
        } else if (item.photo) {
          const photo = item.photo;
          queue.push(async () => {
            const url = await usePhotoLib.getState().photoUrl(photo);
            if (!url) {
              bump();
              return;
            }
            node.url = url;
            await paint(url);
          });
        } else {
          bump();
        }
      }
    }

    // 队列排好，开始按并发上限逐张上画
    pump();

    // 供自动化回归读取空间内的照片数与相框颜色、漂浮冻结状态
    (window as unknown as Record<string, unknown>).__hall3d = {
      count: nodes.length,
      frameColor: backingMat.color.getHex(),
      stillOf: (i: number) => (nodes[i] ? +nodes[i].still.toFixed(3) : null),
      /** 世界半径 / 球壳层数 / 相机可拉到的最大距离，回归用来验证「不是一条线」 */
      radius: R,
      shells: shellLayout(n, R).length,
      maxDistance: controls.maxDistance,
      spread: (() => {
        // 三轴跨度：球形分布下 y 轴跨度应该和 x/z 同量级；盘状布局 y 会接近 0
        const xs = nodes.map((nd) => nd.dir.x * nd.radius);
        const ys = nodes.map((nd) => nd.dir.y * nd.radius);
        const zs = nodes.map((nd) => nd.dir.z * nd.radius);
        const span = (a: number[]) => Math.max(...a) - Math.min(...a);
        return { x: +span(xs).toFixed(2), y: +span(ys).toFixed(2), z: +span(zs).toFixed(2) };
      })(),
    };

    // ---------- 点击 / 悬浮 ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downXY: [number, number] | null = null;

    const onDown = (e: PointerEvent) => {
      downXY = [e.clientX, e.clientY];
    };
    /** 取第一张可见照片：淡出的照片（聚焦态）不挡点击，点空白才能退出聚焦 */
    const pickFirst = (): number | null => {
      const hits = raycaster.intersectObjects(pickables, false);
      for (const h of hits) {
        if ((h.object.parent as THREE.Object3D | null)?.visible) {
          return h.object.userData.index as number;
        }
      }
      return null;
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
      onFocus(pickFirst());
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
      const idx = pickFirst();
      if (idx === null) {
        setHover(null);
        return;
      }
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

    // ---------- 聚焦：把选中的照片飞到中央展示，其余淡出 ----------
    let focusEnv = 0;

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
    const lerp = THREE.MathUtils.lerp;

    /** 聚焦补高清的一次性状态：上次补的是哪张、当前是否正在补 */
    let hdIndex: number | null = null;
    let hdBusy = false;

    /** 整体调暗 / 调亮某张照片的相框、图片与光晕（三件套同进退） */
    const setNodeOpacity = (node: PhotoNode, op: number) => {
      (node.plane.material as THREE.Material).opacity = op;
      (node.backing.material as THREE.Material).opacity = op;
      (node.halo.material as THREE.Material).opacity = op;
    };

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;

      // 有聚焦时停止自动漫游；其余时间按设定巡航
      controls.autoRotate = touringRef.current && focusRef.current === null;

      // 聚焦环境：有选中照片时朝 1 收敛（其余照片淡出），退出时朝 0 回归
      const fActive = focusRef.current !== null;
      focusEnv = Math.min(1, Math.max(0, focusEnv + (fActive ? dt * 3 : -dt * 3)));

      // 点开的那张补一版高清纹理：星系里只有 512，放大后会糊。
      // 只给当前这张补、补完就停，不碰其它照片的内存。
      if (focusRef.current !== hdIndex) {
        hdIndex = focusRef.current;
        const hn = hdIndex === null ? null : nodes[hdIndex];
        if (hn && hn.url && !hn.hd && !hdBusy) {
          hdBusy = true;
          const target = hn;
          void loadImg(hn.url).then((img) => {
            hdBusy = false;
            if (!alive || !img) return;
            const painted = rasterize(img, TEX_MAX_HD);
            if (!painted) return;
            target.hd = true;
            applyTexture(target, painted.tex, painted.aspect);
          });
        }
      }

      // 聚焦照片停在相机正前方的固定距离上（沿相机→星系中心轴线），
      // 所以永远居中、且不论星系多大呈现大小都恒定；其余照片沿旋臂归位并淡出。
      const camLen = camera.position.length() || 1;
      const fk = 1 - FOCUS_DIST / camLen;

      // 漂浮 + 聚焦：选中照片飞抵中央放大，其余淡出；平时整组缓慢自转
      for (const node of nodes) {
        const on = focusRef.current === node.index;
        node.focus = Math.min(1, Math.max(0, node.focus + (on ? dt * 3 : -dt * 3)));
        const f = node.focus;
        node.still = Math.min(1, Math.max(0, node.still + (on ? -dt * 2.4 : dt * 2.4)));
        const bobY = Math.sin(elapsed * 0.55 + node.phase) * node.bob * node.still;
        const sx = node.dir.x * node.radius;
        const sy = node.dir.y * node.radius + bobY;
        const sz = node.dir.z * node.radius;
        const tx = on ? camera.position.x * fk : sx;
        const ty = on ? camera.position.y * fk : sy;
        const tz = on ? camera.position.z * fk : sz;
        node.group.position.set(lerp(sx, tx, f), lerp(sy, ty, f), lerp(sz, tz, f));
        node.group.scale.setScalar(lerp(1, FOCUS_SCALE, f));
        node.group.lookAt(camera.position);
        // 选中照片全亮且始终可见；其余在聚焦环境下淡出（退出聚焦时平滑回归）
        const op = on ? 1 : Math.max(1 - focusEnv, node.focus);
        setNodeOpacity(node, op);
        node.group.visible = on || op > 0.02;
        node.plane.renderOrder = on ? 5 : 0;
        const mat = node.halo.material as THREE.MeshBasicMaterial;
        const target = on ? 0.6 : IS_MOBILE ? 0.2 : 0.12;
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 6);
      }

      // 整片照片世界缓慢自转（球形分布下转起来像是在缓慢漂移，很轻）
      galaxy.rotation.y += dt * 0.01;
      coreGlow.scale.setScalar(R * 0.11 * (1 + Math.sin(elapsed * 0.9) * 0.07));
      coreGlowMat.opacity = 0.42 + Math.sin(elapsed * 0.9 + 0.6) * 0.12;
      coreHaloMat.opacity = 0.17 + Math.sin(elapsed * 0.55) * 0.07;
      for (const nb of nebulas) {
        nb.mat.opacity = nb.baseOp * (0.82 + Math.sin(elapsed * 0.3 + nb.phase) * 0.18);
      }
      stars.rotation.y -= dt * 0.004;

      controls.target.set(0, 0, 0);
      controls.update();
      // 雾密度跟着相机距离走：拉远看全貌时远处的照片不会被雾吃掉（否则一眼全黑），
      // 拉近钻进去时近处清晰、远处沉入深空 —— 纵深层次始终成立
      const camDist = camera.position.length() || R;
      if (scene.fog) (scene.fog as THREE.FogExp2).density = 0.8 / (camDist + R);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
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
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      // 显式释放 WebGL 上下文，避免与主场景争用导致回退后主上下文丢失而白屏
      renderer.dispose();
      renderer.forceContextLoss?.();
      if (dom.parentElement === mount) dom.remove();
    };
  }, [items, onFocus]);

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
