import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { useCaptions } from '../../stores/captions';
import { usePhotoNames } from '../../stores/photoNames';
import { isAndroidShell } from '../../data/photoDisk';
import { hasMediaBridge } from '../../data/androidMedia';
import { entryKey, refineShape } from '../../data/photoLibrary';
import type { PhotoEntry, PhotoShape } from '../../data/photoLibrary';
import { Gallery3D } from './Gallery3D';
import type { HallItem } from './Gallery3D';
import { PhotoViewer } from '../shared/PhotoViewer';
import type { Tag } from '../../data/types';

type WallStyle = 'gallery' | 'corridor' | 'lightbox' | 'hall3d';
type ShapeFilter = 'all' | 'landscape' | 'portrait' | 'other';
type TypeFilter = 'all' | 'image' | 'animated' | 'video';
/** 排序维度：默认（入库顺序）/ 名称 / 拍摄或修改时间 */
type SortKey = 'default' | 'name' | 'time';
interface SortState {
  key: SortKey;
  /** 降序：名称 Z→A、时间 新→旧 */
  desc: boolean;
}

const SORTS: { id: SortKey; name: string; hint: string }[] = [
  { id: 'default', name: '默认', hint: '按收录顺序（本地照片在前）' },
  { id: 'name', name: '名称', hint: '按文件名排序，点击可切换升 / 降序' },
  { id: 'time', name: '时间', hint: '按文件修改时间排序，点击可切换新旧' },
];

const STYLES: { id: WallStyle; name: string; hint: string }[] = [
  { id: 'gallery', name: '展厅', hint: '展墙网格：均匀挂画 + 展签' },
  { id: 'corridor', name: '长廊', hint: '长廊移步：单幅大字 + 两侧窥视' },
  { id: 'lightbox', name: '灯箱', hint: '灯箱独照：暗场聚光 + 展签' },
  { id: 'hall3d', name: '照片空间 · 3D', hint: '所有照片汇成一条旋臂星河：拖动环绕、滚轮缩放、点击居中放大' },
];

const SHAPE_FILTERS: { id: ShapeFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'landscape', name: '横屏' },
  { id: 'portrait', name: '竖屏' },
  { id: 'other', name: '其他' },
];

const TYPE_FILTERS: { id: TypeFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'image', name: '照片' },
  { id: 'animated', name: '动图' },
  { id: 'video', name: '视频' },
];

const AUTOPLAY_MS = 4600;
/** 3D 照片空间一次最多铺多少张（再多 GPU 吃不消，且视觉上会糊成一片） */
const HALL_SLOTS = 220;

interface WallItem {
  key: string;
  title: string;
  sub?: string;
  tags?: Tag[];
  /** 本地照片库条目（照片 / 视频都在磁盘的「省/市/区县」目录里） */
  photo?: PhotoEntry;
  /** 内置占位资源地址（不可删除） */
  src?: string;
  kind: 'image' | 'video' | 'animated';
  shape: PhotoShape;
  /** 文件修改时间（仅本地照片有），用于「按时间排序」 */
  time?: number;
}

/** 名称比较：中文按拼音、数字按数值（IMG_2 排在 IMG_10 前） */
function byName(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

/** 2026/10/20 这样的短日期，用作展签上的时间注记 */
function fmtTime(t?: number): string {
  if (!t) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** 本地照片优先；没有绑定照片库时回退到内置资源占位 */
function buildItems(scope: 'city' | 'district', id: string): WallItem[] {
  const items: WallItem[] = [];
  const data = useData.getState();
  const lib = usePhotoLib.getState();

  const pushLocal = (entries: PhotoEntry[], sub: string) => {
    for (const p of entries) {
      items.push({
        key: `p:${entryKey(p)}`,
        title: p.name.replace(/\.[a-z0-9]+$/i, ''),
        sub,
        photo: p,
        kind: p.kind === 'video' ? 'video' : p.kind === 'animated' ? 'animated' : 'image',
        shape: p.shape,
        ...(p.mtime ? { time: p.mtime } : {}),
      });
    }
  };

  if (scope === 'district') {
    pushLocal(lib.photosFor('district', id), '本地照片');
    // 仅在确实配置了真实图片时回退到内置图，否则让「无图片」走空状态（不显示破图占位）
    const d = data.districts[id];
    if (items.length === 0 && d?.image) {
      items.push({ key: 'cover', title: d.name, tags: d.tags, src: d.image, kind: 'image', shape: 'unknown' });
    }
    for (const s of data.spotsByDistrict[id] ?? []) {
      if (s.image) items.push({ key: `s:${s.id}`, title: s.name, tags: s.tags, src: s.image, kind: 'image', shape: 'unknown' });
    }
  } else {
    const c = data.cities.find((x) => x.id === id);
    pushLocal(lib.photosFor('city', id), '城市照片');
    for (const did of c?.districts ?? []) {
      pushLocal(lib.photosFor('district', did), data.districts[did]?.name ?? '区县照片');
    }

    // 仅在确实配置了真实封面图时回退，否则让「无图片」走空状态
    if (items.length === 0 && c?.banner) {
      items.push({ key: 'banner', title: `${c.name} · 封面`, src: c.banner, kind: 'image', shape: 'unknown' });
    }
    for (const f of c?.foods ?? []) {
      if (f.image) items.push({ key: `f:${f.name}`, title: f.name, src: f.image, kind: 'image', shape: 'unknown' });
    }
      for (const did of c?.districts ?? []) {
      const dd = data.districts[did];
      if (dd?.image) items.push({ key: `d:${did}`, title: dd.name, tags: dd.tags, src: dd.image, kind: 'image', shape: 'unknown' });
    }
  }
  // 自定义名称（桌面端改名）覆盖默认显示名：仅影响展示，不改磁盘文件名
  const names = usePhotoNames.getState().map;
  for (const it of items) {
    const custom = names[it.key];
    if (custom) it.title = custom;
  }
  return items;
}

/** 内置占位图 / 本地静态图：<img> + 尺寸回填（供横竖屏筛选） */
function StaticPhoto({
  item,
  onShape,
  onFail,
  enabled = true,
}: {
  item: WallItem;
  onShape: (key: string, shape: PhotoShape) => void;
  /** 图片确实取不到（地址失效）：上报给父层整体剔除，而不是留在墙上当裂图 */
  onFail?: (key: string) => void;
  /** 懒加载：未进入视口前不取流（见 useItemSrc） */
  enabled?: boolean;
}) {
  const src = useItemSrc(item, enabled);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [item]);

  // 本地照片的 src 是异步取流，短暂为 null 属正常加载态，不能当成失败剔除；
  // 内置图（src 写在数据里）一旦为空就是真的没有图。
  useEffect(() => {
    if (item.photo) return;
    if (!src && onFail) onFail(item.key);
  }, [item, src, onFail]);

  // 加载失败：不渲染任何占位（占位块本身就是用户看到的「裂图」），
  // 交给父层从列表里剔除，墙上只留真正能显示的照片。
  if (failed || !src) return null;

  return (
    <img
      className="wall-media-img"
      src={src}
      alt={item.title}
      draggable={false}
      decoding="async"
      onLoad={(e) => {
        const img = e.currentTarget;
        if (item.photo) {
          const shape = refineShape(item.photo, img.naturalWidth, img.naturalHeight);
          if (shape !== 'unknown') onShape(item.key, shape);
        }
      }}
      onError={() => {
        setFailed(true);
        onFail?.(item.key);
      }}
    />
  );
}

/** 本地视频：静音循环播放；网格里只出首帧，舞台 / 聚焦 / 3D 才自动播 */
function LocalVideo({ item, autoplay }: { item: WallItem; autoplay: boolean }) {
  const src = useItemSrc(item);

  if (!src) return <div className="wall-media wall-media--empty" />;
  return (
    <video
      className="wall-media-img"
      src={src}
      title={item.title}
      muted
      loop
      playsInline
      preload="metadata"
      autoPlay={autoplay}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (item.photo) refineShape(item.photo, v.videoWidth, v.videoHeight);
      }}
    />
  );
}

/**
 * 解析一个展品的可播放地址：本地照片走照片库（内存 File → IndexedDB 缓存 →
 * 目录句柄 / Tauri 文件流），内置占位图直接用静态 src。供网格 / 舞台 / 查看器共用。
 *
 * @param enabled 懒加载开关。照片墙网格里一次性把几十张本地照片（每张都是数 MB 的
 *   全尺寸字节，且要走 JNI 读系统相册）全加载进内存，手机端会直接卡死 / ANR。
 *   所以网格里的展品默认 enabled=false，靠 IntersectionObserver 等滚到视口附近才取流；
 *   舞台主图 / 查看器是单张且一定可见，传 true 立即加载。
 */
function useItemSrc(item: WallItem | null, enabled = true): string | null {
  const photoUrl = usePhotoLib((s) => s.photoUrl);
  const [src, setSrc] = useState<string | null>(item?.photo ? null : (item?.src ?? null));

  useEffect(() => {
    if (!item || !enabled) {
      if (!item) setSrc(null);
      return;
    }
    if (!item.photo) {
      setSrc(item.src ?? null);
      return;
    }
    let alive = true;
    void photoUrl(item.photo).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [item, photoUrl, enabled]);

  return src;
}

function WallMedia({
  item,
  onShape,
  onFail,
  autoplay = false,
  enabled = false,
}: {
  item: WallItem;
  onShape: (key: string, shape: PhotoShape) => void;
  onFail?: (key: string) => void;
  autoplay?: boolean;
  /** 懒加载开关：网格默认 false（滚到视口才取流），舞台主图等单张可见的传 true */
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(enabled);

  // 网格里几十张本地照片若一次性全取流（JNI 读系统相册的全尺寸字节），手机端会卡死。
  // 用 IntersectionObserver 只让滚到（或接近）视口的展品去取流；取过一次后断开观察，
  // 之后即使滚出视口也保持已加载，避免来回滚动反复取流。
  useEffect(() => {
    if (enabled) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  if (item.kind === 'video' && item.photo) {
    return (
      <div className="wall-media wall-media--video" ref={ref}>
        <LocalVideo item={item} autoplay={autoplay} />
        <span className="wall-media-badge" title="视频">
          ▶
        </span>
      </div>
    );
  }
  return (
    <div className="wall-media" ref={ref}>
      <StaticPhoto item={item} onShape={onShape} onFail={onFail} enabled={inView} />
      {item.kind === 'animated' && (
        <span className="wall-media-badge" title="动图">
          GIF
        </span>
      )}
    </div>
  );
}

export function PhotoWall() {
  const photoWall = useUi((s) => s.photoWall);
  const close = useUi((s) => s.closePhotoWall);
  const showToast = useUi((s) => s.showToast);
  const libTotal = usePhotoLib((s) => s.index?.total ?? 0);
  const uploadTo = usePhotoLib((s) => s.uploadTo);
  const removePhotos = usePhotoLib((s) => s.removePhotos);
  /** 手机端系统相册：是否可用 / 是否已授权 / 相册清单 */
  const mediaBridge = hasMediaBridge();
  const mediaGranted = usePhotoLib((s) => s.mediaGranted);
  const albums = usePhotoLib((s) => s.albums);
  const requestMedia = usePhotoLib((s) => s.requestMedia);
  const refreshMedia = usePhotoLib((s) => s.refreshMedia);
  const captionMap = useCaptions((s) => s.map);
  const setCaption = useCaptions((s) => s.set);
  /** 自定义照片名（桌面端改名）覆盖表；订阅以便改名后即时重绘 */
  const photoNames = usePhotoNames((s) => s.map);
  const setPhotoName = usePhotoNames((s) => s.set);
  /** 移动端（Android 套壳）：只做「看照片 / 看视频动图」，不提供上传 / 管理 / 改名 / 删除 */
  const mobileShell = isAndroidShell();
  const showName = !mobileShell;
  /** 正在就地改名的展品 key（仅桌面） */
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** 3D 照片空间容器，全屏时把这个节点交给浏览器全屏 API */
  const hall3dRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<WallStyle>('gallery');
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [touring, setTouring] = useState(false);
  /** 3D 照片空间是否处于全屏 */
  const [isFs, setIsFs] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  /** 查看器（缩放 / 旋转 / 平移）是否打开；与 focus 配合：3D 空间先飞抵、再按需放大 */
  const [viewer, setViewer] = useState(false);
  const [shapeFilter, setShapeFilter] = useState<ShapeFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: 'default', desc: false });
  /** 渲染时回填的画幅（key → shape），用于即时筛选 */
  const [shapes, setShapes] = useState<Record<string, PhotoShape>>({});
  /** 管理模式：多选本地照片批量删除 */
  const [manage, setManage] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** 删除二次确认：第一下进入待确认态（按钮变红），第二下才真删 */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 加载失败 / 根本没有图的条目 key：整条剔除，墙上不留占位 */
  const [failedKeys, setFailedKeys] = useState<Set<string>>(() => new Set());
  /** 手机端「刷新相册」进行中（改相册名 / 新建相册后手动重扫） */
  const [refreshing, setRefreshing] = useState(false);

  /** 手动重扫系统相册：相册改名 / 新建相册后，索引是启动时建的，得手动刷一下才认新名字 */
  const onRefreshAlbums = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshMedia(true);
      const total = usePhotoLib.getState().index?.total ?? 0;
      showToast(total > 0 ? `已重新扫描系统相册（共 ${total} 张）` : '已重新扫描，暂未读到照片');
    } finally {
      setRefreshing(false);
    }
  }, [refreshMedia, showToast]);

  const allItems = useMemo(
    () => (photoWall ? buildItems(photoWall.scope, photoWall.id) : []),
    // 照片库数量 / 改名覆盖表变化时重建（绑定 / 解绑 / 上传 / 删除 / 改名）
    [photoWall, libTotal, photoNames],
  );

  useEffect(() => {
    setActive(0);
    setFocus(null);
    setViewer(false);
    setPlaying(false);
    setTouring(false);
    setStyle('gallery');
    setShapeFilter('all');
    setTypeFilter('all');
    setSort({ key: 'default', desc: false });
    setShapes({});
    setManage(false);
    setSelected(new Set());
    setConfirmDelete(false);
    setFailedKeys(new Set());
  }, [photoWall]);

  // 全屏状态随浏览器事件同步（用户也可能按 Esc 退出全屏）
  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = hall3dRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const onShape = useCallback((key: string, shape: PhotoShape) => {
    setShapes((s) => (s[key] === shape ? s : { ...s, [key]: shape }));
  }, []);

  /** 图片取不到 → 记录并从墙上剔除（不渲染占位块，避免出现「裂图」） */
  const onFail = useCallback((key: string) => {
    setFailedKeys((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);

  const items = useMemo(() => {
    // 取不到图的条目（内置图地址失效 / 本地文件已删）整体剔除，不留占位、不留裂图
    const live = allItems.filter((it) => !failedKeys.has(it.key));
    const byShape =
      shapeFilter === 'all'
        ? live
        : live.filter((it) => {
            const sh = shapes[it.key] ?? it.shape;
            return sh === shapeFilter;
          });
    const list = typeFilter === 'all' ? byShape : byShape.filter((it) => it.kind === typeFilter);
    if (sort.key === 'default') return list;
    const dir = sort.desc ? -1 : 1;
    // 复制后再排：allItems 是 memo 结果，就地排序会污染下次渲染
    return [...list].sort((a, b) => {
      if (sort.key === 'name') return dir * byName(a.title, b.title);
      // 时间排序：没有时间信息的内置图（景点 / 美食封面）一律沉到末尾
      const ta = a.time ?? 0;
      const tb = b.time ?? 0;
      if (ta === tb) return byName(a.title, b.title);
      return dir * (ta - tb);
    });
  }, [allItems, shapeFilter, shapes, sort, failedKeys]);

  /** 点击排序条：点新维度用它的自然方向，点当前维度则翻转升降序 */
  const pickSort = useCallback((key: SortKey) => {
    setSort((s) => {
      if (s.key !== key) return { key, desc: key === 'time' };
      if (key === 'default') return s;
      return { key, desc: !s.desc };
    });
    setActive(0);
    setFocus(null);
  }, []);

  /** 打开查看器：定位到该张并进入可缩放 / 旋转的细看态 */
  const openViewer = useCallback((i: number) => {
    setActive(i);
    setFocus(i);
    setViewer(true);
  }, []);

  const closeViewer = useCallback(() => setViewer(false), []);

  /** 批量上传：把选中的文件写进「省/市/区县」文件夹并入库 */
  const onUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !photoWall) return;
      setBusy(true);
      try {
        const r = await uploadTo(photoWall.scope, photoWall.id, Array.from(files));
        if (r.added > 0) {
          showToast(`已上传 ${r.added} 个到「${r.dir ?? photoWall.title}」`);
        }
        if (r.skipped > 0) showToast(`${r.skipped} 个文件被跳过（格式不支持或写入失败）`);
        if (r.error && r.added === 0) showToast(r.error);
      } finally {
        setBusy(false);
      }
    },
    [photoWall, uploadTo, showToast],
  );

  /** 管理模式：进入 / 退出 */
  const toggleManage = useCallback(() => {
    setManage((m) => {
      if (m) {
        setSelected(new Set());
        setConfirmDelete(false);
      }
      return !m;
    });
  }, []);

  /** 勾选 / 取消一个本地照片（内置占位图没有 photo，不可选） */
  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmDelete(false);
  }, []);

  /** 提交就地改名：空串 = 恢复默认显示名（删除覆盖） */
  const commitRename = useCallback(() => {
    if (renamingKey) setPhotoName(renamingKey, nameDraft);
    setRenamingKey(null);
    setNameDraft('');
  }, [renamingKey, nameDraft, setPhotoName]);

  /** 批量删除：第一下进入待确认，第二下（5 秒内）才执行；删的是磁盘真实文件 */
  const onBatchDelete = useCallback(() => {
    if (busy || selected.size === 0) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 5000);
      return;
    }
    const paths = items.filter((it) => selected.has(it.key) && it.photo).map((it) => it.photo!.path);
    setBusy(true);
    void (async () => {
      const r = await removePhotos(paths);
      setBusy(false);
      setConfirmDelete(false);
      setSelected(new Set());
      if (r.error) showToast(r.error);
      else showToast(`已删除 ${r.removed} 个文件（磁盘照片已移除，不可恢复）`);
    })();
  }, [busy, confirmDelete, selected, items, removePhotos, showToast]);

  /** 查看器内上 / 下一张（同时同步展厅高亮） */
  const step = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      setFocus((f) => {
        const base = f ?? active;
        const next = (base + delta + items.length) % items.length;
        setActive(next);
        return next;
      });
    },
    [items.length, active],
  );

  const counts = useMemo(() => {
    const acc: Record<ShapeFilter, number> = { all: allItems.length, landscape: 0, portrait: 0, other: 0 };
    for (const it of allItems) {
      const sh = shapes[it.key] ?? it.shape;
      if (sh === 'landscape' || sh === 'portrait' || sh === 'other') acc[sh] += 1;
    }
    return acc;
  }, [allItems, shapes]);

  const typeCounts = useMemo(() => {
    const acc: Record<TypeFilter, number> = { all: allItems.length, image: 0, animated: 0, video: 0 };
    for (const it of allItems) {
      if (it.kind === 'image' || it.kind === 'animated' || it.kind === 'video') acc[it.kind] += 1;
    }
    return acc;
  }, [allItems]);

  const go = useCallback(
    (delta: number) => setActive((a) => (items.length ? (a + delta + items.length) % items.length : 0)),
    [items.length],
  );

  // 键盘：左右切换，Esc 关闭（聚焦态优先退出聚焦，由其捕获阶段监听器拦截）
  useEffect(() => {
    if (!photoWall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoWall, go, close]);

  // 聚焦大图态：Esc 先退出聚焦（查看器开着时由查看器自己处理 Esc，这里不抢）
  useEffect(() => {
    if (focus === null || viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFocus(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focus, viewer]);

  // 自动播放（长廊 / 灯箱）
  useEffect(() => {
    if (!playing || !photoWall || items.length < 2) return;
    const timer = window.setInterval(() => go(1), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [playing, photoWall, items.length, go]);

  // 必须 memo：3D 场景的 effect 依赖 items，每次渲染都换新数组会把整个 WebGL 场景重建
  const hallItems = useMemo<HallItem[]>(
    () =>
      items.slice(0, HALL_SLOTS).map((it) => ({
        key: it.key,
        title: it.title,
        kind: it.kind,
        ...(it.sub ? { sub: it.sub } : {}),
        ...(it.photo ? { photo: it.photo } : {}),
        ...(it.src ? { src: it.src } : {}),
      })),
    [items],
  );

  // 查看器目标：必须在早退之前取（hook 顺序）；viewer 打开时它必非空
  const viewerItem = focus !== null ? items[focus] ?? null : null;
  const viewerSrc = useItemSrc(viewerItem);

  if (!photoWall) return null;
  const current = items[Math.min(active, items.length - 1)];
  const autoOk = style === 'corridor' || style === 'lightbox';

  return (
    <div className="wall-backdrop" onPointerDown={close}>
      <section className={`wall-modal wall-modal--${style}`} onPointerDown={(e) => e.stopPropagation()}>
        <header className="wall-head">
          <div className="wall-head-title">
            <h2 className="wall-title">{photoWall.title}</h2>
            <span className="wall-count">
              {items.length} 张{libTotal > 0 && allItems[0]?.photo ? ' · 照片库' : ''}
            </span>
          </div>

          <div className="wall-styles" role="tablist" aria-label="展览风格">
            {STYLES.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={style === s.id}
                title={s.hint}
                className={`wall-style-chip${style === s.id ? ' is-active' : ''}`}
                onClick={() => {
                  setStyle(s.id);
                  setFocus(null);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="wall-head-actions">
            {/* 手机端只要「看」：上传 / 管理（批量删除）都收在桌面端 */}
            {!mobileShell && (
              <>
                <button
                  type="button"
                  className="wall-upload"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  title="批量上传图片 / 视频：写入照片根目录下的「省/市/区县」文件夹（如 浙江省/杭州市/淳安县）"
                >
                  {busy ? '上传中…' : '＋ 上传'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    void onUploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className={`wall-manage-toggle${manage ? ' is-on' : ''}`}
                  onClick={toggleManage}
                  title={manage ? '退出管理模式' : '管理模式：多选照片批量删除（删除的是磁盘文件）'}
                >
                  {manage ? '完成' : '管理'}
                </button>
              </>
            )}
            {autoOk && items.length > 1 && (
              <button
                className={`wall-play${playing ? ' is-on' : ''}`}
                onClick={() => setPlaying((p) => !p)}
                title={playing ? '暂停自动播放' : '自动播放'}
              >
                {playing ? '⏸' : '▶'}
              </button>
            )}
            {style === 'hall3d' && (
              <button
                className={`wall-play${touring ? ' is-on' : ''}`}
                onClick={() => setTouring((t) => !t)}
                title={touring ? '停止自动漫游' : '相机自动漫游'}
              >
                {touring ? '⏸ 漫游' : '▶ 漫游'}
              </button>
            )}
            {mobileShell && mediaBridge && (
              <button
                type="button"
                className={`wall-refresh${refreshing ? ' is-busy' : ''}`}
                onClick={() => void onRefreshAlbums()}
                disabled={refreshing}
                title="重新扫描系统相册：改了相册名 / 新建同名相册后点这里"
                aria-label="刷新相册"
              >
                <span className="wall-refresh-ico">⟳</span>
              </button>
            )}
            <button className="wall-close" onClick={close} aria-label="关闭">
              ×
            </button>
          </div>
        </header>

        {/* 画幅筛选：横屏 / 竖屏 / 其他（非常规比例，多为裁切或修改过） */}
        <div className="wall-shapes">
          {SHAPE_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`wall-shape-chip${shapeFilter === f.id ? ' is-active' : ''}`}
              onClick={() => {
                setShapeFilter(f.id);
                setActive(0);
                setFocus(null);
              }}
              title={f.id === 'other' ? '非常规比例（方形 / 全景 / 极端裁切等）' : undefined}
            >
              {f.name}
              <i>{counts[f.id]}</i>
            </button>
          ))}
        </div>

        {/* 类型筛选：照片 / 动图 / 视频 */}
        <div className="wall-shapes">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              className={`wall-shape-chip${typeFilter === f.id ? ' is-active' : ''}`}
              onClick={() => {
                setTypeFilter(f.id);
                setActive(0);
                setFocus(null);
              }}
              title={f.id === 'image' ? '静态照片' : f.id === 'animated' ? '动图（GIF）' : f.id === 'video' ? '视频' : undefined}
            >
              {f.name}
              <i>{typeCounts[f.id]}</i>
            </button>
          ))}
        </div>

        {/* 排序：默认顺序 / 名称 / 时间，点击当前项翻转升 / 降序 */}
        <div className="wall-sorts">
          <span className="wall-sorts-label">排序</span>
          {SORTS.map((s) => {
            const on = sort.key === s.id;
            const arrow = s.id === 'default' ? '' : sort.desc ? '↓' : '↑';
            return (
              <button
                key={s.id}
                className={`wall-sort-chip${on ? ' is-active' : ''}`}
                title={s.hint}
                aria-pressed={on}
                onClick={() => pickSort(s.id)}
              >
                {s.name}
                {arrow && <em>{arrow}</em>}
              </button>
            );
          })}
          {sort.key === 'time' && (
            <span className="wall-sorts-note">
              {sort.desc ? '最新在前' : '最早在前'} · 无日期的封面图排在最后
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="wall-empty">
            <p>{allItems.length > 0 ? '这个筛选下暂时没有照片。' : '这个范围还没有照片。'}</p>
            {/* 手机端：说明照片从哪来（系统相册同名匹配），并给授权入口 */}
            {mobileShell && mediaBridge && (
              <div className="wall-media-tip">
                <p className="wall-media-tip-title">照片来自手机系统相册</p>
                <p className="wall-media-tip-body">
                  在系统相册里建一个叫「{photoWall.title.replace(/ · 照片墙$/, '')}」的相册，
                  把照片放进去，这里就会自动显示（相册之间平级，直接建同名相册即可）。
                </p>
                {!mediaGranted ? (
                  <button
                    type="button"
                    className="primary-btn wall-media-btn"
                    onClick={() => void requestMedia()}
                  >
                    允许访问系统相册
                  </button>
                ) : (
                  <p className="wall-media-albums">
                    {albums.length > 0
                      ? `已连接系统相册 · 你的相册：${albums
                          .slice(0, 12)
                          .map((a) => `${a.name}（${a.count}）`)
                          .join('、 ')}${albums.length > 12 ? '…' : ''}`
                      : '已连接系统相册，但还没有读到相册（新拍的照片过几秒再来看）。'}
                    {' '}改了相册名或新建相册后，点右上角 <b>⟳</b> 刷新即可重新识别。
                  </p>
                )}
              </div>
            )}
            {!mobileShell && (
              <p className="wall-empty-hint">
                点右上角「＋ 上传」会把照片 / 视频写进照片根目录下的「省 / 市 / 区县」文件夹
                （如 浙江省/杭州市/淳安县），也可在「设置 → 照片库」绑定本地目录。
              </p>
            )}
          </div>
        ) : (
          <>
            {style === 'hall3d' ? (
              <div className="hall3d-wrap" ref={hall3dRef}>
                <Gallery3D items={hallItems} focus={focus} onFocus={setFocus} touring={touring} />
                <div className="hall3d-hint">
                  拖动环绕 · 滚轮缩放 · 点击照片居中放大 · 点空白处退出 · Esc 关闭
                  {items.length > HALL_SLOTS && <b>（空间内铺前 {HALL_SLOTS} 张，共 {items.length} 张）</b>}
                </div>
                <button
                  type="button"
                  className="hall3d-fs"
                  onClick={toggleFullscreen}
                  title={isFs ? '退出全屏' : '全屏预览漫游'}
                >
                  {isFs ? '⤢ 退出全屏' : '⤢ 全屏'}
                </button>
                {focus !== null && items[focus] && (
                  <button
                    type="button"
                    className="hall3d-zoom"
                    onClick={() => openViewer(focus)}
                    title="放大查看：支持缩放 / 旋转 / 平移"
                  >
                    🔍 放大查看
                  </button>
                )}
                {focus !== null && items[focus] && captionMap[items[focus].key] && (
                  <div className="hall3d-cap">{captionMap[items[focus].key]}</div>
                )}
              </div>
            ) : (
              <>
                {style === 'gallery' && (
                  <>
                    {manage && (
                      <div className="wall-manage">
                        <span className="wall-manage-count">
                          已选 <b>{selected.size}</b> / {items.filter((it) => it.photo).length} 张本地照片
                        </span>
                        <div className="wall-manage-actions">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              const keys = items.filter((it) => it.photo).map((it) => it.key);
                              setSelected((prev) =>
                                prev.size >= keys.length ? new Set() : new Set(keys),
                              );
                              setConfirmDelete(false);
                            }}
                          >
                            {selected.size >= items.filter((it) => it.photo).length ? '取消全选' : '全选'}
                          </button>
                          <button
                            type="button"
                            className={`ghost-btn${confirmDelete ? ' is-danger' : ''}`}
                            disabled={selected.size === 0 || busy}
                            onClick={onBatchDelete}
                            title="删除所选照片对应的磁盘文件，不可恢复"
                          >
                            {confirmDelete
                              ? `再点一次确认删除 ${selected.size} 个文件（不可恢复）`
                              : `删除所选${selected.size > 0 ? `（${selected.size}）` : ''}`}
                          </button>
                          <button type="button" className="ghost-btn" onClick={toggleManage}>
                            退出管理
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="wall-gallery">
                      {items.map((it, i) => {
                        const selectable = Boolean(it.photo);
                        const checked = selected.has(it.key);
                        return (
                          <div
                            key={it.key}
                            className={`wall-tile${i === active ? ' is-active' : ''}${checked ? ' is-selected' : ''}${manage && !selectable ? ' is-locked' : ''}`}
                            onClick={() => {
                              if (manage) {
                                if (!selectable) return;
                                toggleSelect(it.key);
                                return;
                              }
                              openViewer(i);
                            }}
                          >
                            <button
                              type="button"
                              className="wall-tile-hit"
                              title={
                                manage
                                  ? selectable
                                    ? `${it.title}（点击${checked ? '取消勾选' : '勾选'}）`
                                    : `${it.title} · 内置图片，不可删除`
                                  : `${it.title}${it.sub ? ` · ${it.sub}` : ''}（点击放大细看）`
                              }
                            >
                              <div className="wall-tile-img">
                                <WallMedia item={it} onShape={onShape} onFail={onFail} />
                              </div>
                              <span className="wall-tile-plaque">
                                {showName && <b>{it.title}</b>}
                                {showName && it.sub && <i>{it.sub}</i>}
                                {sort.key === 'time' && it.time && (
                                  <i className="wall-tile-date">{fmtTime(it.time)}</i>
                                )}
                                {captionMap[it.key] && <em className="wall-cap">{captionMap[it.key]}</em>}
                              </span>
                            </button>
                            {showName && renamingKey !== it.key && (
                              <button
                                type="button"
                                className="wall-tile-edit"
                                title="改名"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingKey(it.key);
                                  setNameDraft(it.title);
                                }}
                              >
                                ✎
                              </button>
                            )}
                            {showName && renamingKey === it.key && (
                              <div className="wall-tile-rename-wrap" onClick={(e) => e.stopPropagation()}>
                                <input
                                  className="wall-tile-rename"
                                  autoFocus
                                  value={nameDraft}
                                  placeholder="改名（留空恢复原名）"
                                  maxLength={60}
                                  onChange={(e) => setNameDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitRename();
                                    if (e.key === 'Escape') {
                                      setRenamingKey(null);
                                      setNameDraft('');
                                    }
                                  }}
                                />
                              </div>
                            )}
                            {manage && selectable && (
                              <span
                                className={`wall-tile-check${checked ? ' is-on' : ''}`}
                                role="checkbox"
                                aria-checked={checked}
                                tabIndex={0}
                                title={checked ? '取消勾选' : '勾选删除'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(it.key);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.stopPropagation();
                                    toggleSelect(it.key);
                                  }
                                }}
                              >
                                ✓
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {(style === 'corridor' || style === 'lightbox') && current && (
                  <div className="wall-stage">
                    {style === 'corridor' && (
                      <div className="wall-stage-peek wall-stage-peek--prev" aria-hidden="true">
                        {items.length > 1 && <WallMedia item={items[(active - 1 + items.length) % items.length]} onShape={onShape} onFail={onFail} enabled />}
                      </div>
                    )}
                    <figure className="wall-stage-main">
                      {/* 点击大图进入查看器：可缩放 / 旋转 / 平移细看 */}
                      <button
                        type="button"
                        className={`wall-stage-img${style === 'corridor' ? ' is-pan' : ''}`}
                        onClick={() => openViewer(active)}
                        title="点击放大细看（支持缩放 / 旋转）"
                      >
                        <WallMedia item={current} onShape={onShape} onFail={onFail} autoplay enabled />
                      </button>
                      <figcaption className="wall-stage-cap">
                        {showName && <b>{current.title}</b>}
                        {showName && current.sub && <i>{current.sub}</i>}
                        {current.time && <i>{fmtTime(current.time)}</i>}
                        {captionMap[current.key] && <em className="wall-cap">{captionMap[current.key]}</em>}
                        <span className="wall-stage-index">
                          {active + 1} / {items.length}
                        </span>
                      </figcaption>
                    </figure>
                    {style === 'corridor' && (
                      <div className="wall-stage-peek wall-stage-peek--next" aria-hidden="true">
                        {items.length > 1 && <WallMedia item={items[(active + 1) % items.length]} onShape={onShape} onFail={onFail} enabled />}
                      </div>
                    )}
                    {style === 'lightbox' && (
                      <>
                        <button className="wall-nav wall-nav--prev" onClick={() => go(-1)} aria-label="上一张">
                          ‹
                        </button>
                        <button className="wall-nav wall-nav--next" onClick={() => go(1)} aria-label="下一张">
                          ›
                        </button>
                      </>
                    )}
                  </div>
                )}

                {(style === 'corridor' || style === 'lightbox') && items.length > 1 && (
                  <div className="wall-strip">
                    {items.map((it, i) => (
                      <button
                        key={it.key}
                        className={`wall-strip-cell${i === active ? ' is-active' : ''}`}
                        onClick={() => setActive(i)}
                        title={it.title}
                      >
                        <WallMedia item={it} onShape={onShape} onFail={onFail} />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* 照片查看器：缩放 / 旋转 / 平移细看。3D 空间是先在场景里飞抵，再按需放大 */}
        {viewer && viewerItem && (
          <PhotoViewer
            src={viewerSrc}
            title={viewerItem.title}
            sub={viewerItem.sub}
            time={viewerItem.time}
            counter={`${(focus ?? 0) + 1} / ${items.length}`}
            caption={captionMap[viewerItem.key] ?? ''}
            onCaption={mobileShell ? undefined : (t) => setCaption(viewerItem.key, t)}
            showName={showName}
            onRename={showName ? (t) => setPhotoName(viewerItem.key, t) : undefined}
            kind={viewerItem.kind === 'video' ? 'video' : 'image'}
            onClose={closeViewer}
            onPrev={items.length > 1 ? () => step(-1) : undefined}
            onNext={items.length > 1 ? () => step(1) : undefined}
            onDelete={
              !mobileShell && viewerItem.photo
                ? () => {
                    const path = viewerItem.photo!.path;
                    void (async () => {
                      const r = await removePhotos([path]);
                      closeViewer();
                      if (r.error) showToast(r.error);
                      else showToast('已删除该文件（磁盘照片已移除，不可恢复）');
                    })();
                  }
                : undefined
            }
          />
        )}
      </section>
    </div>
  );
}
