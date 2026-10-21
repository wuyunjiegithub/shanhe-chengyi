import { create } from 'zustand';
import { useData } from './data';
import {
  buildNameMaps,
  cachePhotoFiles,
  clearPhotoBlobCache,
  clearPhotoUrlCache,
  getStoredHandle,
  isDirectoryPickerSupported,
  mergeIndexes,
  persistIndex,
  photoUrl as resolvePhotoUrl,
  putHandle,
  readIndex,
  removeStoredHandle,
  scanDirectory,
  scanFiles,
} from '../data/photoLibrary';
import type { PhotoEntry, PhotoIndex } from '../data/photoLibrary';

export type PhotoLibStatus = 'unbound' | 'bound' | 'denied' | 'unsupported' | 'error';

/** 实时模式：定时重扫绑定目录，新照片自动进照片墙 */
const LIVE_KEY = 'ds.photoLib.live.v1';
const LIVE_INTERVAL_MS = 20_000;

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

interface PhotoLibState {
  status: PhotoLibStatus;
  index: PhotoIndex | null;
  error: string | null;
  /** 实时模式开关（定时重扫目录） */
  live: boolean;
  /** 最近一次实时扫描是否带回了新照片 */
  lastLiveAdded: number;
  restore: () => Promise<void>;
  /** 选择本地目录并扫描（File System Access API） */
  bind: () => Promise<void>;
  /** 退化路径：由 <input webkitdirectory> 提供文件列表 */
  bindFiles: (files: FileList) => Promise<void>;
  unbind: () => Promise<void>;
  rescan: () => Promise<void>;
  toggleLive: () => Promise<void>;
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

export const usePhotoLib = create<PhotoLibState>((set, get) => ({
  status: 'unbound',
  index: null,
  error: null,
  live: readLive(),
  lastLiveAdded: 0,

  restore: async () => {
    if (!isDirectoryPickerSupported()) {
      // 仍可用 input 退化路径；状态保持 unbound，直到用户选择目录
      const idx = readIndex();
      if (idx) set({ index: idx, status: 'bound' });
      return;
    }
    const idx = readIndex();
    if (idx) set({ index: idx, status: 'bound' });
    const handle = await getStoredHandle();
    if (!handle) return;
    try {
      const ok = await (handle as unknown as { queryPermission: (o: { mode: string }) => Promise<PermissionState> })
        .queryPermission({ mode: 'read' });
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
    if (!isDirectoryPickerSupported()) {
      set({ status: 'unsupported', error: '当前浏览器不支持选择目录，请改用下方「选择文件夹」按钮' });
      return;
    }
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'read' });
      const { index, files } = await scanDirectory(handle, mapsFromContent());
      await putHandle(handle); // 句柄入 IndexedDB，刷新后免重新选择
      clearPhotoUrlCache();
      void cachePhotoFiles(files); // 图片字节入 IndexedDB，句柄失效后也能显示
      applyIndex(index);
      set({ index, status: 'bound', error: null, lastLiveAdded: 0 });
      if (get().live) startLiveTimer(get);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
    await removeStoredHandle();
    clearPhotoUrlCache();
    await clearPhotoBlobCache();
    persistIndex(null);
    set({ index: null, status: 'unbound', error: null, lastLiveAdded: 0 });
  },

  rescan: async () => {
    const handle = await getStoredHandle();
    if (!handle) {
      set({ status: 'unbound', error: '目录句柄已失效，请重新绑定' });
      return;
    }
    try {
      const { index: next, files: nextFiles } = await scanDirectory(handle, mapsFromContent());
      clearPhotoUrlCache();
      void cachePhotoFiles(nextFiles);
      // 实时模式下做增量合并：保留旧顺序，只把新照片标出来
      const prev = get().index;
      const merged = prev && prev.persistent ? mergeIndexes(prev, next) : next;
      applyIndex(merged);
      const added = merged.total - (prev?.total ?? 0);
      set({
        index: merged,
        status: 'bound',
        error: null,
        lastLiveAdded: added > 0 ? added : 0,
      });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
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

  photosFor: (scope, id) => {
    const idx = get().index;
    if (!idx) return [];
    const list = scope === 'district' ? idx.byDistrict[id] : idx.byCity[id];
    return list ?? [];
  },

  photoUrl: (entry) => resolvePhotoUrl(entry),
}));
