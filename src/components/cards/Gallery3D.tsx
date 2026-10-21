import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { usePhotoLib } from '../../stores/photoLib';
import { useWallUploads } from '../../stores/wallUploads';
import type { PhotoEntry } from '../../data/photoLibrary';

export interface HallItem {
  key: string;
  title: string;
  sub?: string;
  /** 本地照片库条目（视频 / 动图 / 静态图） */
  photo?: PhotoEntry;
  /** 手动上传条目 id（字节在 wallUploads 的 IndexedDB 里） */
  uploadId?: string;
  /** 媒体类型（上传条目用；照片库条目的类型在 photo.kind 里） */
  kind?: 'image' | 'video' | 'animated';
  /** 内置占位资源地址 */
  src?: string;
}

/** 单张照片的基准高度；宽度按真实画幅换算，保证不变形、不被裁 */
const PHOTO_H = 2.9;
const MAX_PHOTOS = 220;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 画幅极端时把宽高比夹一下，避免超长全景 / 竖图把画面拉爆 */
function clampAspect(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return 1.5;
  return Math.min(2.8, Math.max(0.45, a));
}

/**
 * 均匀球面分布（Fibonacci lattice）：
 * 比纯随机更均匀，照片不会在某一侧堆成一坨；再叠一点径向抖动变成有厚度的「云」。
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
 * 3D 照片空间：所有照片悬浮在空中的一座「照片云」。
 * - 照片按 Fibonacci 球面铺开、带径向厚度，缓慢上下浮动 + 轻微摆动；
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth || 640, mount.clientHeight || 420);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05070d');

    const camera = new THREE.PerspectiveCamera(
      52,
      (mount.clientWidth || 640) / (mount.clientHeight || 420),
      0.1,
      600,
    );

    // 照片云的半径随照片数量增长，保证间距不挤；照片少时收紧，别让画面空荡
    const R = Math.min(32, Math.max(7.5, 6.5 + 1.45 * Math.sqrt(n)));
    camera.position.set(0, R * 0.38, R * 1.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.5;
    controls.maxDistance = R * 4.2;
    controls.autoRotateSpeed = 0.55;

    // ---------- 星尘：给空间一点纵深参照 ----------
    const dustCount = 700;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const v = fibonacciSphere(dustCount, i).multiplyScalar(R * (1.5 + Math.random() * 2.2));
      dustPos[i * 3] = v.x;
      dustPos[i * 3 + 1] = v.y;
      dustPos[i * 3 + 2] = v.z;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0x9fb4d6,
      size: 0.13,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
    });
    const nodes: PhotoNode[] = [];
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
    const videoTextures: { texture: THREE.VideoTexture; video: HTMLVideoElement }[] = [];
    const pickables: THREE.Mesh[] = [];

    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);
    disposables.push(dustGeo, dustMat);

    // 中心一点微光，避免正中间空得发慌
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16), coreMat);
    scene.add(core);
    disposables.push(coreMat);

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
      const dir = fibonacciSphere(n, i);
      const radius = R * (0.72 + Math.random() * 0.52);
      const group = new THREE.Group();
      group.position.copy(dir).multiplyScalar(radius);
      scene.add(group);

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
      const mediaKind = item.photo?.kind ?? (item.uploadId ? item.kind : undefined);
      if (mediaKind === 'video') {
        const resolveUrl = item.photo
          ? usePhotoLib.getState().photoUrl(item.photo)
          : useWallUploads.getState().url(item.uploadId!);
        void resolveUrl.then((url) => {
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
        if (item.src && !item.photo && !item.uploadId) {
          loadImage(item.src);
        } else if (item.uploadId) {
          void useWallUploads.getState().url(item.uploadId).then((u) => (u ? loadImage(u) : bump()));
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
      // 停在照片外侧一点：沿「球心 → 照片」方向再往外退，正面看这张照片
      const to = node.dir.clone().multiplyScalar(node.radius + PHOTO_H * 1.9);
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
        const target = on ? 0.55 : 0.12;
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 6);
      }
      core.material.opacity = 0.24 + Math.sin(elapsed * 0.8) * 0.08;
      dust.rotation.y += dt * 0.006;

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
