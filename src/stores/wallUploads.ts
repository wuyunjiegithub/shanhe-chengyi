import { create } from 'zustand';

/**
 * 照片墙「手动上传」媒体存储
 * ------------------------
 * 与本地照片库（绑定目录扫描）互补：
 * - 照片放进绑定目录会自动上墙（照片库负责）；
 * - 临时拍的照片、别人给的照片，直接在照片墙里批量上传，归入对应城市 / 区县。
 *
 * 字节进 IndexedDB（刷新不丢），元数据留内存；启动时 restore 拉回清单。
 * 上限：单地点 60 个、总计 400 个 / 200MB，图片 12MB、视频 64MB。
 */

const DB_NAME = 'ds-wall-uploads';
const DB_STORE = 'media';
const MAX_PER_PLACE = 60;
const MAX_TOTAL = 400;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);

export type UploadKind = 'image' | 'video' | 'animated';

export interface UploadEntry {
  id: string;
  scope: 'city' | 'district';
  placeId: string;
  name: string;
  kind: UploadKind;
  bytes: number;
  mtime: number;
  createdAt: number;
}

interface UploadRecord extends UploadEntry {
  blob: Blob;
}

/** 扩展名 → 媒体类型；不认识的格式返回 null（跳过） */
export function uploadKindOf(name: string): UploadKind | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (ext === 'gif') return 'animated';
  if (IMAGE_EXT.has(ext)) return 'image';
  return null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `up-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** object URL 缓存（blob 常驻内存，直到 remove / 页面关闭） */
const urlCache = new Map<string, string>();

export interface AddResult {
  added: number;
  skipped: number;
}

interface WallUploadsState {
  entries: UploadEntry[];
  /** 条目变化版本号：照片墙靠它触发重建 */
  version: number;
  /** 已占用字节数 */
  bytes: number;
  restore: () => Promise<void>;
  add: (scope: 'city' | 'district', placeId: string, files: File[]) => Promise<AddResult>;
  remove: (id: string) => Promise<void>;
  url: (id: string) => Promise<string | null>;
  forPlace: (scope: 'city' | 'district', placeId: string) => UploadEntry[];
}

export const useWallUploads = create<WallUploadsState>((set, get) => ({
  entries: [],
  version: 0,
  bytes: 0,

  restore: async () => {
    try {
      const db = await openDb();
      const all = await new Promise<UploadRecord[]>((resolve, reject) => {
        const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
        req.onsuccess = () => resolve((req.result as UploadRecord[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      const entries = all
        .map(({ blob: _blob, ...rest }) => rest)
        .sort((a, b) => a.createdAt - b.createdAt);
      set({ entries, version: get().version + 1, bytes: entries.reduce((n, e) => n + e.bytes, 0) });
    } catch {
      /* IndexedDB 不可用时保持空态：上传功能降级为不可用，其它不受影响 */
    }
  },

  add: async (scope, placeId, files) => {
    let added = 0;
    let skipped = 0;
    try {
      const db = await openDb();
      const inPlace = get().entries.filter((e) => e.scope === scope && e.placeId === placeId).length;
      let room = Math.max(0, MAX_PER_PLACE - inPlace);
      let bytes = get().bytes;
      const fresh: UploadEntry[] = [];
      for (const file of files) {
        if (added + fresh.length >= MAX_TOTAL || bytes >= MAX_TOTAL_BYTES || room <= 0) {
          skipped += 1;
          continue;
        }
        const kind = uploadKindOf(file.name);
        const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (!kind || file.size > cap) {
          skipped += 1;
          continue;
        }
        const id = nextId();
        const rec: UploadRecord = {
          id,
          scope,
          placeId,
          name: file.name,
          kind,
          bytes: file.size,
          mtime: file.lastModified || Date.now(),
          createdAt: Date.now(),
          blob: file,
        };
        await new Promise<void>((resolve) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(rec);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
        const { blob: _blob, ...meta } = rec;
        fresh.push(meta);
        bytes += file.size;
        room -= 1;
        added += 1;
      }
      db.close();
      if (fresh.length > 0) {
        set((s) => ({
          entries: [...s.entries, ...fresh],
          version: s.version + 1,
          bytes: s.bytes + fresh.reduce((n, e) => n + e.bytes, 0),
        }));
      }
    } catch {
      skipped += files.length;
    }
    return { added, skipped };
  },

  remove: async (id) => {
    try {
      const db = await openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      db.close();
    } catch {
      /* 索引删不掉也继续清内存态 */
    }
    const url = urlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== id),
      version: s.version + 1,
      bytes: Math.max(0, s.bytes - (s.entries.find((e) => e.id === id)?.bytes ?? 0)),
    }));
  },

  url: async (id) => {
    const cached = urlCache.get(id);
    if (cached) return cached;
    try {
      const db = await openDb();
      const rec = await new Promise<UploadRecord | null>((resolve) => {
        const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
        req.onsuccess = () => resolve((req.result as UploadRecord) ?? null);
        req.onerror = () => resolve(null);
      });
      db.close();
      if (!rec) return null;
      const url = URL.createObjectURL(rec.blob);
      urlCache.set(id, url);
      return url;
    } catch {
      return null;
    }
  },

  forPlace: (scope, placeId) =>
    get()
      .entries.filter((e) => e.scope === scope && e.placeId === placeId)
      .sort((a, b) => b.createdAt - a.createdAt),
}));
