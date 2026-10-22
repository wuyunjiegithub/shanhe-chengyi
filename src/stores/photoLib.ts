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
import type { PhotoEntry, PhotoIndex } from '../data/photoLibrary';
import { getDisk, isAndroidShell, isMediaName } from '../data/photoDisk';
import type { DiskKind } from '../data/photoDisk';
import {
  hasMediaBridge,
  listAndroidAlbumPhotos,
  listAndroidAlbums,
} from '../data/androidMedia';
import type { AndroidPhoto } from '../data/androidMedia';

export type PhotoLibStatus = 'unbound' | 'bound' | 'denied' | 'unsupported' | 'error';

/** 实时模式：定时重扫绑定目录，新照片自动进照片墙 */
const LIVE_KEY = 'ds.photoLib.live.v1';
const LIVE_INTERVAL_MS = 20_000;

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
  restore: () => Promise<void>;
  /** 选择本地照片根目录并扫描（换绑也走这里） */
  bind: () => Promise<void>;
  /** 退化路径：由 <input webkitdirectory> 提供文件列表 */
  bindFiles: (files: FileList) => Promise<void>;
  unbind: () => Promise<void>;
  rescan: () => Promise<void>;
  toggleLive: () => Promise<void>;
  /** 上传照片 / 视频到「省/市/区县」文件夹并入库 */
  uploadTo: (scope: 'city' | 'district', id: string, files: File[]) => Promise<UploadResult>;
  /** 删除本地照片（磁盘真实文件），返回删除数 */
  removePhotos: (paths: string[]) => Promise<{ removed: number; error?: string }>;
  photosFor: (scope: 'city' | 'district', id: string) => PhotoEntry[];
  photoUrl: (entry: PhotoEntry) => Promise<string | null>;
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
  const result = await scanDisk(disk, mapsFromContent());
  clearPhotoUrlCache();
  void cachePhotoFiles(result.files);
  applyIndex(result.index);
  set({ index: result.index, status: 'bound', error: null, lastLiveAdded: 0 });
}

/**
 * 手机端索引：把系统相册按「相册名 = 区县名 / 城市名」同名匹配。
 * 相册名就是照片所在目录名（Android 相册之间平级、没有子相册），
 * 所以在相册 App 里建一个叫「淳安县」的相册，这里就会自动对上。
 * 同名相册不存在时该区县就是 0 张，不会凭空造出占位。
 */
function buildAlbumIndex(): PhotoIndex | null {
  const albums = listAndroidAlbums();
  if (albums.length === 0) return null;
  const counts = new Map(albums.map((a) => [a.name, a.count]));
  const { districts, cities } = useData.getState();

  const byDistrict: Record<string, PhotoEntry[]> = {};
  for (const d of Object.values(districts)) {
    if (!counts.has(d.name)) continue;
    const list = listAndroidAlbumPhotos(d.name).map(albumEntry);
    if (list.length > 0) byDistrict[d.id] = list;
  }
  const byCity: Record<string, PhotoEntry[]> = {};
  for (const c of cities) {
    if (!counts.has(c.name)) continue;
    const list = listAndroidAlbumPhotos(c.name).map(albumEntry);
    if (list.length > 0) byCity[c.id] = list;
  }

  let total = 0;
  for (const list of Object.values(byDistrict)) total += list.length;
  for (const list of Object.values(byCity)) total += list.length;
  if (total === 0) return null;

  return {
    rootName: '系统相册',
    boundAt: new Date().toISOString(),
    persistent: true,
    total,
    byDistrict,
    byCity,
  };
}

/** 相册照片 → 索引条目；path 用绝对路径，photoUrl 据此走 convertFileSrc */
function albumEntry(p: AndroidPhoto): PhotoEntry {
  const shape = p.width > 0 && p.height > 0 ? classifyShape(p.width, p.height) : 'unknown';
  return {
    path: p.path,
    name: p.name || p.path.split('/').pop() || '照片',
    kind: 'image',
    shape,
    mtime: p.mtime || undefined,
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
      const next = await scanDisk(disk, mapsFromContent());
      // 只有磁盘上真有增删才失效缓存。无条件清的话，实时模式每 20s 就会 revoke 掉
      // 正在使用的 blob URL：列表重新「加载中」闪烁、正在播放的视频直接断流。
      const sig = indexSignature(next.index);
      if (sig !== lastSignature) {
        clearPhotoUrlCache();
        lastSignature = sig;
      }
      void cachePhotoFiles(next.files);
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
      });
    } catch (err) {
      const msg = message(err);
      set({
        status: 'error',
        error: /permission|authoriz|not allowed|security/i.test(msg) ? '目录授权已失效，请重新绑定' : msg,
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

  restore: async () => {
    const disk = getDisk();
    set({ diskKind: disk.kind });
    const idx = readIndex();
    if (idx) set({ index: idx, status: 'bound' });

    // 手机端：不扫目录树，改成按相册名与区县名做同名匹配（用户在系统相册里怎么归，
    // App 就怎么显示，不需要导入 / 复制，也不需要理解目录结构）
    if (isAndroidShell() && hasMediaBridge()) {
      try {
        const albumIndex = buildAlbumIndex();
        if (albumIndex) {
          applyIndex(albumIndex);
          set({ index: albumIndex, status: 'bound', error: null, lastLiveAdded: 0 });
          return;
        }
      } catch {
        /* 权限未授予或查询失败：落到下面的目录逻辑，由设置面板提示重新绑定 */
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
    set({
      index: null,
      status: 'unbound',
      error: null,
      lastLiveAdded: 0,
      diskKind: disk.kind,
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
        error: skipped > 0 ? '没有受支持的图片或视频（jpg / png / webp / gif / mp4 / webm / mov）' : undefined,
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
        /* 退化到下面的缓存逻辑 */
      }
    }
    return resolvePhotoUrl(entry);
  },
  };
});
