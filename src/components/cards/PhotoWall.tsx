import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { useWallUploads } from '../../stores/wallUploads';
import { classifyShape, refineShape } from '../../data/photoLibrary';
import type { PhotoEntry, PhotoShape } from '../../data/photoLibrary';
import { SmartImage } from '../shared/SmartImage';
import { Gallery3D } from './Gallery3D';
import type { HallItem } from './Gallery3D';
import { PhotoViewer } from '../shared/PhotoViewer';
import type { Tag } from '../../data/types';

type WallStyle = 'gallery' | 'corridor' | 'lightbox' | 'hall3d';
type ShapeFilter = 'all' | 'landscape' | 'portrait' | 'other';
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
  { id: 'hall3d', name: '照片空间 · 3D', hint: '所有照片悬浮在空中：拖动环绕、滚轮缩放、点击飞抵近看' },
];

const SHAPE_FILTERS: { id: ShapeFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'landscape', name: '横屏' },
  { id: 'portrait', name: '竖屏' },
  { id: 'other', name: '其他' },
];

const AUTOPLAY_MS = 4600;
/** 3D 照片空间一次最多铺多少张（再多 GPU 吃不消，且视觉上会糊成一片） */
const HALL_SLOTS = 220;

interface WallItem {
  key: string;
  title: string;
  sub?: string;
  tags?: Tag[];
  photo?: PhotoEntry;
  /** 手动上传条目 id（字节在 wallUploads 的 IndexedDB 里） */
  uploadId?: string;
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

  // 手动上传的媒体排最前（最新放的优先可见），带「本机上传」展签
  for (const u of useWallUploads.getState().forPlace(scope, id)) {
    items.push({
      key: `u:${u.id}`,
      title: u.name.replace(/\.[a-z0-9]+$/i, ''),
      sub: '本机上传',
      uploadId: u.id,
      kind: u.kind,
      shape: 'unknown',
      ...(u.mtime ? { time: u.mtime } : {}),
    });
  }

  const pushLocal = (entries: PhotoEntry[], sub: string) => {
    for (const p of entries) {
      items.push({
        key: `p:${p.path}`,
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
  return items;
}

/** 内置占位图 / 本地静态图：<img> + 尺寸回填（供横竖屏筛选） */
function StaticPhoto({
  item,
  onShape,
}: {
  item: WallItem;
  onShape: (key: string, shape: PhotoShape) => void;
}) {
  const src = useItemSrc(item);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [item]);

  if (failed || !src) {
    return (
      <div className="wall-media wall-media--empty">
        <SmartImage src={src ?? undefined} alt={item.title} label={item.title} className="wall-media-img" />
      </div>
    );
  }
  return (
    <img
      className="wall-media-img"
      src={src}
      alt={item.title}
      draggable={false}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (item.photo) {
          const shape = refineShape(item.photo, img.naturalWidth, img.naturalHeight);
          if (shape !== 'unknown') onShape(item.key, shape);
        } else if (item.uploadId) {
          // 上传项没有可回写的库条目，直接把画幅报给筛选状态
          const shape = classifyShape(img.naturalWidth, img.naturalHeight);
          if (shape !== 'unknown') onShape(item.key, shape);
        }
      }}
      onError={() => setFailed(true)}
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
 * 解析一个展品的可播放地址：手动上传走 wallUploads（IndexedDB blob），
 * 本地照片走照片库（内存 File → IndexedDB 缓存 → 目录句柄），
 * 内置占位图直接用静态 src。供网格 / 舞台 / 查看器共用。
 */
function useItemSrc(item: WallItem | null): string | null {
  const photoUrl = usePhotoLib((s) => s.photoUrl);
  const uploadUrl = useWallUploads((s) => s.url);
  const [src, setSrc] = useState<string | null>(item?.photo || item?.uploadId ? null : (item?.src ?? null));

  useEffect(() => {
    if (!item) {
      setSrc(null);
      return;
    }
    if (item.uploadId) {
      let alive = true;
      void uploadUrl(item.uploadId).then((url) => {
        if (alive) setSrc(url);
      });
      return () => {
        alive = false;
      };
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
  }, [item, photoUrl, uploadUrl]);

  return src;
}

function WallMedia({
  item,
  onShape,
  autoplay = false,
}: {
  item: WallItem;
  onShape: (key: string, shape: PhotoShape) => void;
  autoplay?: boolean;
}) {
  if (item.kind === 'video' && (item.photo || item.uploadId)) {
    return (
      <div className="wall-media wall-media--video">
        <LocalVideo item={item} autoplay={autoplay} />
        <span className="wall-media-badge" title="视频">
          ▶
        </span>
      </div>
    );
  }
  return (
    <div className="wall-media">
      <StaticPhoto item={item} onShape={onShape} />
      {item.kind === 'animated' && (
        <span className="wall-media-badge" title="动图">
          GIF
        </span>
      )}
      {item.uploadId && (
        <span className="wall-media-badge wall-media-badge--upload" title="在照片墙里手动上传">
          上传
        </span>
      )}
      {item.photo?.fresh && (
        <span className="wall-media-badge wall-media-badge--live" title="实时扫描新发现">
          LIVE
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
  const uploadVersion = useWallUploads((s) => s.version);
  const uploadAdd = useWallUploads((s) => s.add);
  const uploadRemove = useWallUploads((s) => s.remove);
  const fileRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<WallStyle>('gallery');
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [touring, setTouring] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  /** 查看器（缩放 / 旋转 / 平移）是否打开；与 focus 配合：3D 空间先飞抵、再按需放大 */
  const [viewer, setViewer] = useState(false);
  const [shapeFilter, setShapeFilter] = useState<ShapeFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: 'default', desc: false });
  /** 渲染时回填的画幅（key → shape），用于即时筛选 */
  const [shapes, setShapes] = useState<Record<string, PhotoShape>>({});

  const allItems = useMemo(
    () => (photoWall ? buildItems(photoWall.scope, photoWall.id) : []),
    // 照片库数量 / 手动上传变化时重建（绑定/解绑/上传/删除）
    [photoWall, libTotal, uploadVersion],
  );

  useEffect(() => {
    setActive(0);
    setFocus(null);
    setViewer(false);
    setPlaying(false);
    setTouring(false);
    setStyle('gallery');
    setShapeFilter('all');
    setSort({ key: 'default', desc: false });
    setShapes({});
  }, [photoWall]);

  const onShape = useCallback((key: string, shape: PhotoShape) => {
    setShapes((s) => (s[key] === shape ? s : { ...s, [key]: shape }));
  }, []);

  const items = useMemo(() => {
    const list =
      shapeFilter === 'all'
        ? allItems
        : allItems.filter((it) => {
            const sh = shapes[it.key] ?? it.shape;
            return sh === shapeFilter;
          });
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
  }, [allItems, shapeFilter, shapes, sort]);

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

  /** 批量上传：把选中的文件归入当前范围（城市 / 区县） */
  const onUploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !photoWall) return;
      const r = await uploadAdd(photoWall.scope, photoWall.id, Array.from(files));
      if (r.added > 0) showToast(`已上传 ${r.added} 个媒体到「${photoWall.title.replace(' · 照片墙', '')}」`);
      if (r.skipped > 0) showToast(`${r.skipped} 个文件被跳过（格式不支持或超出大小上限）`);
    },
    [photoWall, uploadAdd, showToast],
  );

  /** 删除一个手动上传（网格 × 与查看器内删除共用） */
  const onDeleteUpload = useCallback(
    async (id: string) => {
      await uploadRemove(id);
      showToast('已删除该上传');
    },
    [uploadRemove, showToast],
  );

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
        ...(it.uploadId ? { uploadId: it.uploadId } : {}),
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
              {items.length} 张{libTotal > 0 && allItems[0]?.photo ? ' · 本地照片库' : ''}
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
            <button
              type="button"
              className="wall-upload"
              onClick={() => fileRef.current?.click()}
              title="批量上传图片 / 视频到这个范围（照片不在绑定目录里也能先传上来看）"
            >
              ＋ 上传
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
            <p className="wall-empty-hint">
              可在「设置 → 照片库」绑定本地目录，或点右上角「＋ 上传」直接把照片 / 视频传进来。
            </p>
          </div>
        ) : (
          <>
            {style === 'hall3d' ? (
              <>
                <Gallery3D items={hallItems} focus={focus} onFocus={setFocus} touring={touring} />
                <div className="hall3d-hint">
                  拖动环绕 · 滚轮缩放 · 点击照片飞抵近看 · 点空白处退出 · Esc 关闭
                  {items.length > HALL_SLOTS && <b>（空间内铺前 {HALL_SLOTS} 张，共 {items.length} 张）</b>}
                </div>
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
              </>
            ) : (
              <>
                {style === 'gallery' && (
                  <div className="wall-gallery">
                    {items.map((it, i) => (
                      <div
                        key={it.key}
                        className={`wall-tile${i === active ? ' is-active' : ''}`}
                        onClick={(e) => {
                          // 删除钮自己处理点击，不冒泡到「打开查看器」
                          if ((e.target as HTMLElement).closest('.wall-tile-del')) return;
                          openViewer(i);
                        }}
                      >
                        <button
                          type="button"
                          className="wall-tile-hit"
                          title={`${it.title}${it.sub ? ` · ${it.sub}` : ''}（点击放大细看）`}
                        >
                          <div className="wall-tile-img">
                            <WallMedia item={it} onShape={onShape} />
                          </div>
                          <span className="wall-tile-plaque">
                            <b>{it.title}</b>
                            {it.sub && <i>{it.sub}</i>}
                            {sort.key === 'time' && it.time && (
                              <i className="wall-tile-date">{fmtTime(it.time)}</i>
                            )}
                          </span>
                        </button>
                        {it.uploadId && (
                          <span
                            className="wall-tile-del"
                            role="button"
                            tabIndex={0}
                            title="删除这个上传"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteUpload(it.uploadId!);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                void onDeleteUpload(it.uploadId!);
                              }
                            }}
                          >
                            ×
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {(style === 'corridor' || style === 'lightbox') && current && (
                  <div className="wall-stage">
                    {style === 'corridor' && (
                      <div className="wall-stage-peek wall-stage-peek--prev" aria-hidden="true">
                        {items.length > 1 && <WallMedia item={items[(active - 1 + items.length) % items.length]} onShape={onShape} />}
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
                        <WallMedia item={current} onShape={onShape} autoplay />
                      </button>
                      <figcaption className="wall-stage-cap">
                        <b>{current.title}</b>
                        {current.sub && <i>{current.sub}</i>}
                        {current.time && <i>{fmtTime(current.time)}</i>}
                        <span className="wall-stage-index">
                          {active + 1} / {items.length}
                        </span>
                      </figcaption>
                    </figure>
                    {style === 'corridor' && (
                      <div className="wall-stage-peek wall-stage-peek--next" aria-hidden="true">
                        {items.length > 1 && <WallMedia item={items[(active + 1) % items.length]} onShape={onShape} />}
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
                        <WallMedia item={it} onShape={onShape} />
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
            kind={viewerItem.kind === 'video' ? 'video' : 'image'}
            onClose={closeViewer}
            onPrev={items.length > 1 ? () => step(-1) : undefined}
            onNext={items.length > 1 ? () => step(1) : undefined}
            onDelete={
              viewerItem.uploadId
                ? () => {
                    void onDeleteUpload(viewerItem.uploadId!);
                    closeViewer();
                  }
                : undefined
            }
          />
        )}
      </section>
    </div>
  );
}
