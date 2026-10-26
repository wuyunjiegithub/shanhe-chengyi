import { create } from 'zustand';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useData } from './data';
import {
  buildNameMaps,
  classifyShape,
  cachePhotoFiles,
  clearPhotoBlobCache,
  clearPhotoUrlCache,
  getStoredHandle,
  mergeIndexes,
  persistIndex,
  photoUrl as resolvePhotoUrl,
  readIndex,
  removeCachedBlobs,
  removeStoredHandle,
  scanDisk,
  scanFiles,
} from '../data/photoLibrary';
import type { PhotoEntry, PhotoIndex, PhotoKind } from '../data/photoLibrary';
import { getDisk, isAndroidShell, isMediaName } from '../data/photoDisk';
import type { DiskKind } from '../data/photoDisk';
import {
  allAndroidPhotos,
  hasMediaBridge,
  hasMediaPermission,
  listAndroidAlbums,
  readAndroidPhoto,
  requestMediaPermission,
} from '../data/androidMedia';
import type { AndroidAlbum, AndroidPhoto } from '../data/androidMedia';

export type PhotoLibStatus = 'unbound' | 'bound' | 'denied' | 'unsupported' | 'error';

/** 实时模式：定时重扫绑定目录，新照片自动进照片墙 */
const LIVE_KEY = 'ds.photoLib.live.v1';
const LIVE_INTERVAL_MS = 20_000;
/** 是否已经替用户拉过一次系统相册权限弹窗（只拉一次，别每次都弹） */
const MEDIA_ASKED_KEY = 'ds.photoLib.mediaAsked.v1';

/** 上传 / 删除结果 */
export interface UploadResult {
  added: number;
  skipped: number;
  /** 失败或取消时的原因（展示给用户） */
  error?: string;
  /** 实际写入的目录（相对根目录，如 浙江省/杭州市/淳安县） */
  dir?: string;
}

function readLive(): boolean {
  try {
    return localStorage.getItem(LIVE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLive(on: boolean): void {
  try {
    if (on) localStorage.setItem(LIVE_KEY, '1');
    else localStorage.removeItem(LIVE_KEY);
  } catch {
    /* 忽略 */
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 路径片段清洗：去掉 Windows / Unix 不允许的字符，防空目录名 */
function sanitizeSeg(s: string): string {
  const cleaned = String(s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/^\.+/, '');
  return cleaned || '未分类';
}

/**
 * 地点 → 相对目录。
 * 桌面：三级树「省/市/区县」，便于在文件管理器里按行政区翻找。
 * 手机：**扁平单级，目录名 = 系统相册名**（Android 的相册名就是照片所在目录名，
 * 且相册之间平级、没有子相册），所以「淳安县」在系统相册里就是一个叫淳安县的相册，
 * 不用让用户去理解任何目录树。
 */
export function placeDirFor(scope: 'city' | 'district', id: string): string | null {
  const { districts, cities } = useData.getState();
  if (isAndroidShell()) {
    if (scope === 'district') {
      const d = districts[id];
      return d ? sanitizeSeg(d.name) : null;
    }
    const c = cities.find((x) => x.id === id);
    return c ? sanitizeSeg(c.name) : null;
  }
  if (scope === 'district') {
    const d = districts[id];
    if (!d) return null;
    const city = cities.find((c) => c.id === d.city);
    return [d.province, city?.name ?? d.city, d.name].map(sanitizeSeg).join('/');
  }
  const c = cities.find((x) => x.id === id);
  if (!c) return null;
  return [c.province, c.name].map(sanitizeSeg).join('/');
}

interface PhotoLibState {
  status: PhotoLibStatus;
  index: PhotoIndex | null;
  error: string | null;
  /** 实时模式开关（定时重扫目录） */
  live: boolean;
  /** 最近一次实时扫描是否带回了新照片 */
  lastLiveAdded: number;
  /** 当前磁盘后端：fsa（浏览器）/ tauri（套壳）/ none */
  diskKind: DiskKind;
  /** 手机端系统相册：相册列表（名称 + 张数），用于「没绑同名相册」时给提示 */
  albums: AndroidAlbum[];
  /** 是否已授权读系统相册 */
  mediaGranted: boolean;
  /** 扫描进度（绑定 / 重新扫描时更新）；total=0 表示总数未知（不确定进度条） */
  scanProgress: { done: number; total: number; scanning: boolean };
  restore: () => Promise<void>;
  /** 选择本地照片根目录并扫描（换绑也走这里） */
  bind: () => Promise<void>;
  /** 退化路径：由 <input webkitdirectory> 提供文件列表 */
  bindFiles: (files: FileList) => Promise<void>;
  unbind: () => Promise<void>;
  rescan: () => Promise<void>;
  toggleLive: () => Promise<void>;
  /** 申请系统相册读取权限，并在拿到后重建相册索引 */
  requestMedia: () => Promise<void>;
  /** 重新拉一次相册索引（权限弹窗回来后、切回前台、手动刷新时用；force 绕过节流） */
  refreshMedia: (force?: boolean) => Promise<void>;
  /** 上传照片 / 视频到「省/市/区县」文件夹并入库 */
  uploadTo: (scope: 'city' | 'district', id: string, files: File[]) => Promise<UploadResult>;
  /** 删除本地照片（磁盘真实文件），返回删除数 */
  removePhotos: (paths: string[]) => Promise<{ removed: number; error?: string }>;
  photosFor: (scope: 'city' | 'district', id: string) => PhotoEntry[];
  photoUrl: (entry: PhotoEntry) => Promise<string | null>;
  /** 读照片字节：优先走磁盘后端直接读（套壳 / FSA 都稳定），失败再回退到「解析 URL 后 fetch」 */
  photoBlob: (entry: PhotoEntry) => Promise<Blob | null>;
}

function mapsFromContent() {
  const { districts, cities } = useData.getState();
  return buildNameMaps(Object.values(districts), cities);
}

/**
 * 套壳兜底：Tauri（WebView2）/ Android WebView 里 window.showDirectoryPicker 往往「存在但不可用」，
 * 调用时才抛 NotSupported / SecurityError。这时自动改用 <input webkitdirectory> 弹系统文件夹对话框。
 * 代价：拿不到持久化句柄，实时重扫不可用，但仍能一次性导入整棵目录。
 */
function pickDirectoryByInput(): Promise<FileList | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const el = document.createElement('input');
    el.type = 'file';
    el.multiple = true;
    el.accept = 'image/*,video/*';
    (el as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.opacity = '0';
    document.body.appendChild(el);

    let settled = false;
    const finish = (files: FileList | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      el.remove();
      resolve(files);
    };
    // 取消对话框不会触发 change：用「窗口重新拿到焦点」兜底收尾
    const onFocus = () => {
      window.setTimeout(() => finish(el.files && el.files.length ? el.files : null), 400);
    };
    window.addEventListener('focus', onFocus);
    el.addEventListener('change', () => {
      finish(el.files && el.files.length ? el.files : null);
    });
    el.click();
  });
}

function applyIndex(index: PhotoIndex): void {
  persistIndex(index);
}

let liveTimer: number | null = null;

function stopLiveTimer(): void {
  if (liveTimer !== null) {
    window.clearInterval(liveTimer);
    liveTimer = null;
  }
}

function startLiveTimer(get: () => PhotoLibState): void {
  stopLiveTimer();
  liveTimer = window.setInterval(() => {
    void get().rescan();
  }, LIVE_INTERVAL_MS);
}

/** 扫描磁盘后端并把结果落库（供 bind / rescan / 上传后刷新共用） */
async function scanAndApply(
  disk: ReturnType<typeof getDisk>,
  set: (partial: Partial<PhotoLibState>) => void,
): Promise<void> {
  set({ scanProgress: { done: 0, total: 0, scanning: true } });
  const result = await scanDisk(disk, mapsFromContent(), (done, total) =>
    set({ scanProgress: { done, total, scanning: true } }),
  );
  clearPhotoUrlCache();
  applyIndex(result.index);
  set({ index: result.index, status: 'bound', error: null, lastLiveAdded: 0, scanProgress: { done: result.index.total, total: result.index.total, scanning: false } });
}

/**
 * 手机端索引：把系统相册按「相册名 = 区县名 / 城市名」同名匹配。
 * 相册名就是照片所在目录名（Android 相册之间平级、没有子相册），
 * 所以在相册 App 里建一个叫「淳安县」的相册，这里就会自动对上。
 * 同名相册不存在时该区县就是 0 张，不会凭空造出占位。
 *
 * 一次查询拉全量照片（带 bucket），在 JS 侧按相册名分组——
 * 比起「每个区县查一次」少几百轮 MediaStore 扫描。
 */
async function buildAlbumIndex(): Promise<PhotoIndex | null> {
  const photos = await allAndroidPhotos();
  if (photos.length === 0) return null;
  const { districts, cities } = useData.getState();

  // 相册名 → 区县 id。Android 相册名就是照片所在目录名，用户在相册 App 里建一个
  // 「淳安县」，这里就要能对上。索引的 byDistrict 一律按区县 id 存（与磁盘扫描一致），
  // 所以必须先按名字查到 id；同时兼容「淳安」这种去掉市县后缀的叫法（精确名优先）。
  const districtByName = new Map<string, string>();
  const districtByNorm = new Map<string, string>();
  for (const d of Object.values(districts)) {
    districtByName.set(d.name, d.id);
    const norm = d.name.replace(/[省市区县新区]+$/, '');
    if (norm && !districtByNorm.has(norm)) districtByNorm.set(norm, d.id);
  }

  const byDistrict: Record<string, PhotoEntry[]> = {};
  const byCity: Record<string, PhotoEntry[]> = {};
  const others: Record<string, PhotoEntry[]> = {};

  // 实况 / 动态照片配对去重：同一相册里，和某张静帧同名的视频段（iPhone 实况传到安卓
  // 会拆成「同名.HEIC + 同名.MOV」两条 MediaStore 记录）应被跳过，只留静帧，避免同一
  // 瞬间既显示静帧又显示短视频、造成重复。
  const stillStemsByBucket = new Map<string, Set<string>>();
  for (const p of photos) {
    if (androidKind(p) === 'image') {
      const stem = p.name.replace(/\.[^.]+$/, '');
      const set = stillStemsByBucket.get(p.bucket);
      if (set) set.add(stem);
      else stillStemsByBucket.set(p.bucket, new Set([stem]));
    }
  }
  const isCompanion = (p: AndroidPhoto): boolean => {
    if (androidKind(p) !== 'video') return false;
    const stem = p.name.replace(/\.[^.]+$/, '');
    return stillStemsByBucket.get(p.bucket)?.has(stem) ?? false;
  };

  for (const p of photos) {
    if (isCompanion(p)) continue; // 实况配对视频，跳过
    const entry = albumEntry(p);
    const districtId = districtByName.get(p.bucket) ?? districtByNorm.get(p.bucket);
    if (districtId) {
      (byDistrict[districtId] ??= []).push(entry);
      continue;
    }
    const city = cities.find(
      (c) => c.name === p.bucket || c.name.replace(/[省市区县]+$/, '') === p.bucket,
    );
    if (city) {
      (byCity[city.id] ??= []).push(entry);
    } else {
      // 与任何市区县都不同名的相册：先留着，后面按「未匹配」汇总（不丢照片）
      (others[p.bucket] ??= []).push(entry);
    }
  }

  let total = 0;
  for (const list of [...Object.values(byDistrict), ...Object.values(byCity)]) total += list.length;

  return {
    rootName: '系统相册',
    boundAt: new Date().toISOString(),
    persistent: true,
    total,
    byDistrict,
    byCity,
  };
}

/** 相册条目类型：按 MIME 判定（系统相册里 .mov 是视频、.gif 是动图，其余是图） */
function androidKind(p: AndroidPhoto): PhotoKind {
  const m = (p.mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m === 'image/gif') return 'animated';
  return 'image';
}

/** 相册照片 → 索引条目；path 用绝对路径，photoUrl 据此走 convertFileSrc */
function albumEntry(p: AndroidPhoto): PhotoEntry {
  const shape = p.width > 0 && p.height > 0 ? classifyShape(p.width, p.height) : 'unknown';
  return {
    path: p.path,
    name: p.name || p.path.split('/').pop() || '照片',
    kind: androidKind(p),
    shape,
    mtime: p.mtime || undefined,
    uri: p.uri,
  };
}

/** 索引里所有照片路径拼成的指纹：只有它变了才说明磁盘上真有增删 */
function indexSignature(index: PhotoIndex | null): string {
  if (!index) return '';
  const paths: string[] = [];
  for (const list of Object.values(index.byDistrict)) for (const e of list) paths.push(e.path);
  for (const list of Object.values(index.byCity)) for (const e of list) paths.push(e.path);
  paths.sort();
  return `${index.total}::${paths.join('|')}`;
}

export const usePhotoLib = create<PhotoLibState>((set, get) => {
  /** 正在进行的扫描（rescan 串行化用） */
  let scanInflight: Promise<void> | null = null;
  /** 上一轮扫描的指纹，用于判断是否需要失效 blob URL 缓存 */
  let lastSignature = '';
  /** 相册照片兜底读字节产生的 object URL（uri → url），解绑时统一回收 */
  const albumUrls = new Map<string, string>();
  /** 上一次相册查询的时间戳：visibilitychange 可能频繁触发，节流避免重复查 MediaStore */
  let lastMediaQueryAt = 0;
  const MEDIA_QUERY_THROTTLE_MS = 2500;

  /** 读相册 + 建索引。没权限 / 不是手机端时静默返回。 */
  const loadMediaAlbums = async (): Promise<boolean> => {
    if (!hasMediaBridge()) return false;
    const granted = await hasMediaPermission();
    set({ mediaGranted: granted });
    if (!granted) return false;
    try {
      const albums = await listAndroidAlbums();
      set({ albums });
      const albumIndex = await buildAlbumIndex();
      if (albumIndex) {
        applyIndex(albumIndex);
        set({ index: albumIndex, status: 'bound', error: null, lastLiveAdded: 0 });
        return true;
      }
    } catch {
      /* 查询失败：保持现状，由照片墙里的入口重试 */
    }
    return false;
  };

  const doRescan = async (): Promise<void> => {
    const disk = getDisk();
    set({ diskKind: disk.kind });
    if (disk.kind === 'none') {
      set({ status: 'unbound', error: '当前环境不支持访问本地目录' });
      return;
    }
    if (!(await disk.hasRoot())) {
      set({
        status: 'unbound',
        error: disk.kind === 'fsa' ? '目录句柄已失效，请重新绑定' : '尚未选择照片目录',
      });
      return;
    }
    try {
      set({ scanProgress: { done: 0, total: 0, scanning: true } });
      const next = await scanDisk(disk, mapsFromContent(), (done, total) =>
        set({ scanProgress: { done, total, scanning: true } }),
      );
      // 只有磁盘上真有增删才失效缓存。无条件清的话，实时模式每 20s 就会 revoke 掉
      // 正在使用的 blob URL：列表重新「加载中」闪烁、正在播放的视频直接断流。
      const sig = indexSignature(next.index);
      if (sig !== lastSignature) {
        clearPhotoUrlCache();
        lastSignature = sig;
      }
      // 实时模式 / 上传后刷新都走增量合并：保留旧顺序，只把新照片标出来，剔除已删除的
      const prev = get().index;
      const merged = prev && prev.persistent ? mergeIndexes(prev, next.index) : next.index;
      applyIndex(merged);
      const added = merged.total - (prev?.total ?? 0);
      set({
        index: merged,
        status: 'bound',
        error: null,
        lastLiveAdded: added > 0 ? added : 0,
        scanProgress: { done: merged.total, total: merged.total, scanning: false },
      });
    } catch (err) {
      const msg = message(err);
      set({
        status: 'error',
        error: /permission|authoriz|not allowed|security/i.test(msg) ? '目录授权已失效，请重新绑定' : msg,
        scanProgress: { done: 0, total: 0, scanning: false },
      });
    }
  };

  return {
  status: 'unbound',
  index: null,
  error: null,
  live: readLive(),
  lastLiveAdded: 0,
  diskKind: 'none',
  albums: [],
  mediaGranted: false,
  scanProgress: { done: 0, total: 0, scanning: false },

  restore: async () => {
    const disk = getDisk();
    set({ diskKind: disk.kind });
    const idx = readIndex();
    if (idx) set({ index: idx, status: 'bound' });

    // 手机端：不扫目录树，改成按相册名与区县名做同名匹配（用户在系统相册里怎么归，
    // App 就怎么显示，不需要导入 / 复制，也不需要理解目录结构）
    if (isAndroidShell() && hasMediaBridge()) {
      if (await loadMediaAlbums()) return;
      // 没权限：首次启动帮用户拉一次系统弹窗（只拉一次，之后由照片墙里的按钮负责）
      if (!get().mediaGranted && !localStorage.getItem(MEDIA_ASKED_KEY)) {
        try {
          localStorage.setItem(MEDIA_ASKED_KEY, '1');
        } catch {
          /* 忽略 */
        }
        void get().requestMedia();
        return;
      }
    }

    if (disk.kind === 'tauri') {
      // 记住过根目录：静默重扫恢复现场；没记住则等用户在设置里选
      if (await disk.hasRoot()) {
        try {
          await scanAndApply(disk, set);
        } catch (err) {
          set({ status: get().index ? 'bound' : 'unbound', error: message(err) });
        }
      }
      if (get().live && get().status === 'bound') startLiveTimer(get);
      return;
    }

    if (disk.kind === 'none') return; // 仍可用 input 退化路径；等用户主动导入

    // FSA：有索引先秒开，再校验句柄权限（有句柄时静默校验，不打断启动）
    const handle = await getStoredHandle();
    if (!handle) return;
    try {
      const ok = await (
        handle as unknown as { queryPermission: (o: { mode: string }) => Promise<PermissionState> }
      ).queryPermission({ mode: 'read' });
      // granted 之外（prompt / denied）都不打扰用户，点照片时再申请
      if (ok === 'granted') return;
      set({ status: 'bound' });
    } catch {
      /* 句柄失效：保留索引，重新绑定时会覆盖 */
    }
    // 已绑定且开着实时模式：启动定时重扫
    if (get().live && get().status === 'bound') startLiveTimer(get);
  },

  bind: async () => {
    const disk = getDisk();
    set({ diskKind: disk.kind });

    if (disk.kind === 'none') {
      set({ status: 'unsupported', error: '当前环境不支持选择目录，请改用下方「选择文件夹」按钮' });
      return;
    }

    try {
      // 总是弹出选择框：首次绑定与「更换根目录」共用这一入口
      const ok = await disk.repickRoot();
      if (!ok) {
        set({ status: get().index ? 'bound' : 'unbound' });
        return;
      }
      await scanAndApply(disk, set);
      if (get().live) startLiveTimer(get);
    } catch (err) {
      const msg = message(err);
      if (/abort/i.test(msg)) {
        set({ status: get().index ? 'bound' : 'unbound' });
        return;
      }
      // 套壳环境：选择器在调用时才暴露不可用 —— 不报错，静默切到一次性文件夹选择
      if (/not supported|unsupported|denied|not allowed|security|permission|not implemented|invalidstate/i.test(msg)) {
        set({ status: 'unbound', error: null });
        const files = await pickDirectoryByInput();
        if (files) await get().bindFiles(files);
        return;
      }
      set({ status: 'error', error: msg });
    }
  },

  bindFiles: async (files) => {
    try {
      const result = scanFiles(files, mapsFromContent());
      clearPhotoUrlCache();
      void cachePhotoFiles(result.files);
      applyIndex(result.index);
      set({ index: result.index, status: 'bound', error: null, lastLiveAdded: 0 });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  unbind: async () => {
    stopLiveTimer();
    const disk = getDisk();
    await removeStoredHandle();
    clearPhotoUrlCache();
    await clearPhotoBlobCache();
    persistIndex(null);
    for (const url of albumUrls.values()) URL.revokeObjectURL(url);
    albumUrls.clear();
    set({
      index: null,
      status: 'unbound',
      error: null,
      lastLiveAdded: 0,
      diskKind: disk.kind,
      albums: [],
    });
  },

  rescan: async () => {
    // 触发源有 5 处（20s 实时定时、开启实时、上传后、删除后、手动重扫）。
    // 不串行化的话两轮会重叠：先开始却晚完成的那一轮，会用「写盘/删盘之前」的快照
    // 覆盖新索引 —— 刚上传的照片凭空消失、刚删除的照片复活。
    if (scanInflight) return scanInflight;
    scanInflight = doRescan();
    try {
      await scanInflight;
    } finally {
      scanInflight = null;
    }
  },

  toggleLive: async () => {
    const next = !get().live;
    writeLive(next);
    set({ live: next });
    if (next) {
      startLiveTimer(get);
      await get().rescan(); // 立即来一轮，让用户马上看到效果
    } else {
      stopLiveTimer();
    }
  },

  requestMedia: async () => {
    if (!hasMediaBridge()) return;
    await requestMediaPermission();
    // 权限弹窗是异步的，这里查到的多半还是 false；真正生效靠 visibilitychange 后的 refreshMedia
    set({ mediaGranted: await hasMediaPermission() });
    if (get().mediaGranted) await loadMediaAlbums();
  },

  refreshMedia: async (force = false) => {
    if (!hasMediaBridge()) return;
    // 相册改名 / 新建相册后要能重新匹配到：这里每次都真查一遍 MediaStore。
    // 手动点「刷新相册」force=true 绕过节流；切回前台自动触发的才节流，避免频繁查询。
    const now = Date.now();
    if (!force && now - lastMediaQueryAt < MEDIA_QUERY_THROTTLE_MS) return;
    lastMediaQueryAt = now;
    await loadMediaAlbums();
  },

  uploadTo: async (scope, id, files) => {
    const disk = getDisk();
    set({ diskKind: disk.kind });
    if (disk.kind === 'none') {
      return {
        added: 0,
        skipped: files.length,
        error: '当前环境不支持写入本地文件夹；可先用「设置 → 照片库 → 选择文件夹」一次性导入',
      };
    }
    const relDir = placeDirFor(scope, id);
    if (!relDir) return { added: 0, skipped: files.length, error: '找不到对应的城市 / 区县' };

    const media = files.filter((f) => isMediaName(f.name));
    const skipped = files.length - media.length;
    if (media.length === 0) {
      return {
        added: 0,
        skipped,
        error: skipped > 0 ? '没有受支持的图片或视频（jpg / png / webp / gif / avif / heic / mp4 / webm / mov）' : undefined,
      };
    }

    try {
      const ready = await disk.ensureRoot();
      if (!ready) return { added: 0, skipped: files.length, error: '未选择照片文件夹，已取消上传' };
      const written = await disk.writeFiles(relDir, media);
      // 写盘成功后增量重扫：新照片以「本地照片」身份入库（带 LIVE 标记）
      await get().rescan();
      return {
        added: written.length,
        skipped: skipped + (media.length - written.length),
        dir: relDir,
      };
    } catch (err) {
      const msg = message(err);
      if (/write|permission|not allowed|security|NEED_WRITE/i.test(msg)) {
        return {
          added: 0,
          skipped: files.length,
          error: '没有照片目录的写入权限：请到「设置 → 照片库」重新选择根目录（允许修改）',
        };
      }
      return { added: 0, skipped: files.length, error: msg };
    }
  },

  removePhotos: async (paths) => {
    const disk = getDisk();
    if (disk.kind === 'none') {
      return { removed: 0, error: '当前环境不支持删除本地文件' };
    }
    if (paths.length === 0) return { removed: 0 };
    try {
      const removed = await disk.deleteFiles(paths);
      await removeCachedBlobs(paths);
      await get().rescan(); // 重扫后已删条目即从索引消失
      return { removed };
    } catch (err) {
      return { removed: 0, error: message(err) };
    }
  },

  photosFor: (scope, id) => {
    const idx = get().index;
    if (!idx) return [];
    const list = scope === 'district' ? idx.byDistrict[id] : idx.byCity[id];
    return list ?? [];
  },

  photoUrl: async (entry) => {
    const disk = getDisk();
    if (disk.kind === 'tauri') {
      // 套壳内文件系统路径可直接转成媒体流，省去读字节
      const direct = disk.directUrl(entry.path);
      if (direct) return direct;
    }
    // 相册来源的条目 path 是绝对路径（磁盘扫描的条目是相对根目录的路径），
    // 未绑定根目录时也要能出图，这里直接转成 asset URL。
    if (isAndroidShell() && entry.path.startsWith('/')) {
      try {
        return convertFileSrc(entry.path);
      } catch {
        /* 退化到下面的兜底逻辑 */
      }
    }
    // 兜底：DATA 路径缺失（部分新机型）时，走原生桥按 content:// URI 读字节
    if (entry.uri) {
      const cached = albumUrls.get(entry.uri);
      if (cached) return cached;
      const blob = await readAndroidPhoto(entry.uri);
      if (blob) {
        const url = URL.createObjectURL(blob);
        albumUrls.set(entry.uri, url);
        return url;
      }
    }
    return resolvePhotoUrl(entry);
  },

  photoBlob: async (entry) => {
    // 系统相册条目：字节走原生桥（fs 插件不认绝对路径，会因作用域拒掉）
    if (entry.uri) {
      const blob = await readAndroidPhoto(entry.uri);
      if (blob) return blob;
    }
    const disk = getDisk();
    try {
      const blob = await disk.readFile(entry.path);
      if (blob) return blob;
    } catch {
      /* 走下方兜底 */
    }
    // 兜底：照片库已解析出的可显示 URL 再 fetch（例如 FSA 句柄失效但字节缓存仍在）
    try {
      const url = await resolvePhotoUrl(entry);
      if (url) return await (await fetch(url)).blob();
    } catch {
      /* 取不到字节 */
    }
    return null;
  },
  };
});

// 从系统权限弹窗 / 相册 App 切回本 App：补建相册索引。
// 权限是异步授予的（弹窗里点「允许」后本 App 才 resume），
// 所以不能只依赖启动时那一次查询。
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void usePhotoLib.getState().refreshMedia();
    }
  });
}
