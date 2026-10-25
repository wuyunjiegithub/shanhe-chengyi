/**
 * 本地照片库
 * ----------
 * 绑定用户本地目录，按「省 / 市 / 区县」文件夹结构建立索引，
 * 照片墙优先展示本地照片，缺图时回退到内置 /assets 资源。
 *
 * - 目录句柄存 IndexedDB（File System Access API），刷新后无需重新授权即可再读；
 * - 索引（相对路径清单）存 localStorage，用于秒开照片墙；
 * - 不支持 File System Access 的环境退化为 <input webkitdirectory>，
 *   照片仅在当次会话内存中可用。
 * - 支持视频（mp4 / webm / mov）与动图（gif）；「实时模式」下定时重扫目录，
 *   新放入的照片会自动出现在照片墙里。
 *
 * 目录的实际读写删由 photoDisk 的后端适配（浏览器 FSA / Tauri 原生文件系统）。
 */

import type { PhotoDisk } from './photoDisk';

const DB_NAME = 'ds-photolib';
const DB_STORE = 'handles';
const HANDLE_KEY = 'root';
const INDEX_KEY = 'ds.photoLib.index.v1';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);

/** 媒体类型：静态图 / 视频 / 动图（gif 归为动图） */
export type PhotoKind = 'image' | 'video' | 'animated';
/** 画幅分类：横屏 / 竖屏 / 其他（非常规比例，多为裁切或修改过） */
export type PhotoShape = 'landscape' | 'portrait' | 'other' | 'unknown';

export interface PhotoEntry {
  /** 相对绑定根目录的路径，如 浙江省/杭州市/淳安县/001.jpg */
  path: string;
  name: string;
  kind: PhotoKind;
  /** 横屏 / 竖屏 / 其他（非常规比例，多为裁切或修改过） */
  shape: PhotoShape;
  /** 文件最后修改时间（ms），用于照片墙「按时间排序」 */
  mtime?: number;
  /** 实时扫描新发现（同一次绑定会话内高亮） */
  fresh?: boolean;
  /** 系统相册来源的 content:// URI（仅 Android 套壳）；path 缺失时靠它兜底读字节 */
  uri?: string;
}

/**
 * 条目的稳定键：磁盘扫描条目用相对路径；系统相册条目在部分新机型上
 * MediaStore.DATA 为空，只能靠 content:// URI 区分（都按 path 记会全部撞成同一个键）。
 */
export function entryKey(entry: PhotoEntry): string {
  return entry.path || entry.uri || entry.name;
}

export interface PhotoIndex {
  rootName: string;
  boundAt: string;
  /** 是否持有可持久化的目录句柄 */
  persistent: boolean;
  total: number;
  byDistrict: Record<string, PhotoEntry[]>;
  byCity: Record<string, PhotoEntry[]>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

/* ---------------- IndexedDB 句柄存取 ---------------- */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle ?? null;
  } catch {
    return null;
  }
}

async function dropHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 名称匹配 ---------------- */

/** 归一化行政区名：去空白与常见后缀，便于「淳安」匹配「淳安县」 */
function normName(s: string): string {
  return String(s)
    .trim()
    .replace(/\s+/g, '')
    .replace(/(省|市|区|县|新区|自治州|地区|盟)$/u, '');
}

export interface NameMaps {
  /** 归一化区县名 → 区县 id */
  district: Map<string, string>;
  /** 归一化城市名 → 城市 id */
  city: Map<string, string>;
}

export function buildNameMaps(
  districts: { id: string; name: string }[],
  cities: { id: string; name: string }[],
): NameMaps {
  // normName 已去掉「省/市/区/县」等后缀，因此「淳安」与「淳安县」落到同一键
  const district = new Map<string, string>();
  for (const d of districts) {
    const key = normName(d.name);
    if (key && !district.has(key)) district.set(key, d.id);
  }
  const city = new Map<string, string>();
  for (const c of cities) {
    const key = normName(c.name);
    if (key && !city.has(key)) city.set(key, c.id);
  }
  return { district, city };
}

function isImage(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return IMAGE_EXT.has(fileName.slice(dot + 1).toLowerCase());
}

function isVideo(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXT.has(fileName.slice(dot + 1).toLowerCase());
}

function isMedia(fileName: string): boolean {
  return isImage(fileName) || isVideo(fileName);
}

/** 文件扩展名 → 媒体类型 */
function kindOf(fileName: string): PhotoKind {
  const dot = fileName.lastIndexOf('.');
  const ext = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (ext === 'gif') return 'animated';
  return 'image';
}

/* ---------------- 画幅三分类 ---------------- */

/**
 * 按宽高比分类：常规横屏 / 竖屏归两类，其余（方形、全景、极端裁切）
 * 归「其他」——这类大多是被裁切或修改过的图。
 * 阈值取 1.12 / 0.89（即 16:9 与 9:16 内侧、4:3 与 3:4 外侧）。
 */
export function classifyShape(width: number, height: number): PhotoShape {
  if (!width || !height || width <= 0 || height <= 0) return 'unknown';
  const ratio = width / height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < 0.89) return 'portrait';
  return 'other';
}

/* ---------------- 扫描 ---------------- */

interface RawHit {
  path: string;
  name: string;
  file: File | null;
  mtime: number;
  districtId: string | null;
  cityId: string | null;
}

/** 把原始命中装配为索引（保持「省/市/区县」归属与单区县上限） */
function buildIndex(
  rootName: string,
  persistent: boolean,
  hits: RawHit[],
  probed: { kind: PhotoKind; shape: PhotoShape }[],
  freshFor?: (path: string) => boolean,
): PhotoIndex {
  const byDistrict: Record<string, PhotoEntry[]> = {};
  const byCity: Record<string, PhotoEntry[]> = {};
  let total = 0;
  const push = (bucket: Record<string, PhotoEntry[]>, key: string, entry: PhotoEntry) => {
    const list = bucket[key] ?? (bucket[key] = []);
    list.push(entry);
    total += 1;
  };
  hits.forEach((h, i) => {
    const entry: PhotoEntry = {
      path: h.path,
      name: h.name,
      kind: probed[i].kind,
      shape: probed[i].shape,
      ...(h.mtime ? { mtime: h.mtime } : {}),
      ...(freshFor?.(h.path) ? { fresh: true } : {}),
    };
    if (h.districtId) push(byDistrict, h.districtId, entry);
    else if (h.cityId) push(byCity, h.cityId, entry);
  });
  return { rootName, boundAt: new Date().toISOString(), persistent, total, byDistrict, byCity };
}

/** 从相对路径判定归属：最深层往上游找第一个能匹配的行政区 */
function placeHit(segs: string[], maps: NameMaps): { districtId: string | null; cityId: string | null } {
  const dirs = segs.slice(0, -1);
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const did = maps.district.get(normName(dirs[i]));
    if (did) return { districtId: did, cityId: null };
  }
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const cid = maps.city.get(normName(dirs[i]));
    if (cid) return { districtId: null, cityId: cid };
  }
  return { districtId: null, cityId: null };
}

/**
 * 经磁盘后端扫描整棵照片目录（FSA 句柄或 Tauri 路径，由 photoDisk 适配），
 * 按「省 / 市 / 区县」文件夹名归属到行政区，产出索引与字节缓存。
 */
export async function scanDisk(
  disk: PhotoDisk,
  maps: NameMaps,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const hits = await disk.scan(onProgress);
  const raw: RawHit[] = hits.map((h) => ({ ...h, ...placeHit(h.path.split('/'), maps) }));
  // 轻扫描：不在此阶段探测尺寸（需读文件头），画幅交由照片墙渲染时懒回填（refineShape）
  const probed = raw.map((h) => ({ kind: kindOf(h.name), shape: 'unknown' as PhotoShape }));
  const label = await disk.rootLabel();
  memoryFiles.clear();
  const files = new Map<string, File>();
  for (const h of raw) if (h.file) files.set(h.path, h.file);
  return { index: buildIndex(label, true, raw, probed), files };
}

/** 由 <input webkitdirectory> 的文件列表建索引（会话内有效） */
function scanFileList(files: FileList, maps: NameMaps): { index: PhotoIndex; files: Map<string, File> } {
  const hits: RawHit[] = [];
  const store = new Map<string, File>();

  for (const file of Array.from(files)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!rel) continue;
    const segs = rel.split('/');
    const fileName = segs[segs.length - 1];
    if (!isMedia(fileName)) continue;
    const path = segs.slice(1).join('/'); // 去掉根目录名
    if (store.has(path)) continue;
    store.set(path, file);
    hits.push({
      path,
      name: fileName,
      file,
      mtime: file.lastModified || 0,
      ...placeHit(segs.slice(1), maps),
    });
  }

  // webkitdirectory 拿得到 File 本体，同步做不了异步探测；用轻量同步路径：
  // 图片类型可直接由扩展名判定，画幅统一渲染时懒探测补齐。
  const probed = hits.map((h) => ({ kind: kindOf(h.name), shape: 'unknown' as PhotoShape }));
  return { index: buildIndex('本地照片', false, hits, probed), files: store };
}

/* ---------------- 索引持久化 ---------------- */

/** 兼容旧索引（无 kind / shape 字段） */
function normalizeEntry(e: PhotoEntry): PhotoEntry {
  return {
    path: e.path,
    name: e.name,
    kind: e.kind ?? kindOf(e.name),
    shape: e.shape ?? 'unknown',
    ...(typeof e.mtime === 'number' ? { mtime: e.mtime } : {}),
    ...(e.fresh ? { fresh: true } : {}),
  };
}

function normalizeIndex(idx: PhotoIndex): PhotoIndex {
  const byDistrict: Record<string, PhotoEntry[]> = {};
  const byCity: Record<string, PhotoEntry[]> = {};
  for (const [k, list] of Object.entries(idx.byDistrict ?? {})) {
    byDistrict[k] = list.map(normalizeEntry);
  }
  for (const [k, list] of Object.entries(idx.byCity ?? {})) {
    byCity[k] = list.map(normalizeEntry);
  }
  return { ...idx, byDistrict, byCity };
}

export function readIndex(): PhotoIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return null;
    const idx = JSON.parse(raw) as PhotoIndex;
    if (!idx || typeof idx.total !== 'number') return null;
    return normalizeIndex(idx);
  } catch {
    return null;
  }
}

function writeIndex(index: PhotoIndex | null): void {
  try {
    if (index) localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    else localStorage.removeItem(INDEX_KEY);
  } catch {
    /* 忽略配额错误 */
  }
}

/**
 * 实时模式合并：旧条目保留原顺序与已探测画幅，新条目标记 fresh 追加到末尾，
 * 已消失的条目（删除 / 外部移除）剔除。
 */
export function mergeIndexes(prev: PhotoIndex, next: PhotoIndex): PhotoIndex {
  const byDistrict: Record<string, PhotoEntry[]> = {};
  const byCity: Record<string, PhotoEntry[]> = {};
  let total = 0;
  const mergeBucket = (a: PhotoEntry[] = [], b: PhotoEntry[] = []): PhotoEntry[] => {
    const indexB = new Map(b.map((e) => [e.path, e]));
    const out: PhotoEntry[] = [];
    for (const e of a) {
      const cur = indexB.get(e.path);
      if (!cur) continue; // 已消失：剔除（删除照片后不再残留）
      indexB.delete(e.path);
      // 保留已探测的画幅与 fresh 标记，其余以最新扫描为准
      out.push({
        ...cur,
        shape: e.shape !== 'unknown' ? e.shape : cur.shape,
        ...(e.fresh ? { fresh: true } : {}),
      });
    }
    // 新条目（本轮新增）：追加到末尾并标记 fresh
    for (const e of b) {
      if (indexB.has(e.path)) out.push({ ...e, fresh: true });
    }
    return out;
  };
  for (const [k, list] of Object.entries(next.byDistrict)) {
    byDistrict[k] = mergeBucket(prev.byDistrict[k], list);
    total += byDistrict[k].length;
  }
  for (const [k, list] of Object.entries(next.byCity)) {
    byCity[k] = mergeBucket(prev.byCity[k], list);
    total += byCity[k].length;
  }
  return { ...next, byDistrict, byCity, total };
}

/** 渲染拿到真实尺寸后回填画幅（懒探测兜底） */
export function refineShape(entry: PhotoEntry, width: number, height: number): PhotoShape {
  const shape = classifyShape(width, height);
  if (entry.shape !== shape) entry.shape = shape;
  return shape;
}

/* ---------------- 照片读取（object URL 缓存） ---------------- */

const urlCache = new Map<string, string>();
const memoryFiles = new Map<string, File>();
const URL_CACHE_MAX = 240;

async function resolveFileFromHandle(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const segs = path.split('/');
  const fileName = segs.pop();
  if (!fileName) return null;
  let dir: FileSystemDirectoryHandle = root;
  for (const seg of segs) {
    try {
      dir = await dir.getDirectoryHandle(seg);
    } catch {
      return null;
    }
  }
  try {
    return await dir.getFileHandle(fileName).then((h) => h.getFile());
  } catch {
    return null;
  }
}

/** 读 IndexedDB 里的照片字节（扫描时写入；句柄失效后靠它兜底） */
async function getCachedBlob(path: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(BLOB_PREFIX + path);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

/** 建 object URL 并放进 LRU 缓存 */
function rememberUrl(path: string, blob: Blob): string {
  if (urlCache.size >= URL_CACHE_MAX) {
    const oldest = urlCache.keys().next().value;
    if (oldest) {
      URL.revokeObjectURL(urlCache.get(oldest)!);
      urlCache.delete(oldest);
    }
  }
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  return url;
}

export async function photoUrl(entry: PhotoEntry): Promise<string | null> {
  const cachedUrl = urlCache.get(entry.path);
  if (cachedUrl) return cachedUrl;

  const mem = memoryFiles.get(entry.path);
  if (mem) return rememberUrl(entry.path, mem);

  // 字节缓存优先：目录句柄失效 / 刷新页面后仍能显示
  const cachedBlob = await getCachedBlob(entry.path);
  if (cachedBlob) return rememberUrl(entry.path, cachedBlob);

  const handle = await getStoredHandle();
  if (!handle) return null;
  const file = await resolveFileFromHandle(handle, entry.path);
  if (!file) return null;
  // 顺手补进缓存，下次不必再走句柄授权
  void cachePhotoFiles(new Map([[entry.path, file]]));
  return rememberUrl(entry.path, file);
}

export function clearPhotoUrlCache(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  memoryFiles.clear();
}

/* ---------------- 对外动作 ---------------- */

export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const q = await (handle as FileSystemDirectoryHandle & { queryPermission?: (o: { mode: string }) => Promise<PermissionState> }).queryPermission?.({ mode: 'read' });
  if (q === 'granted') return true;
  const r = await (handle as FileSystemDirectoryHandle & { requestPermission?: (o: { mode: string }) => Promise<PermissionState> }).requestPermission?.({ mode: 'read' });
  return r === 'granted';
}

export interface ScanResult {
  index: PhotoIndex;
  files: Map<string, File> | null;
}

export function scanFiles(files: FileList, maps: NameMaps): ScanResult {
  const result = scanFileList(files, maps);
  memoryFiles.clear();
  for (const [path, file] of result.files!) memoryFiles.set(path, file);
  return result;
}

/* ---------------- 照片字节缓存（IndexedDB） ----------------
 * 目录句柄授权会随会话失效，<input> 选的文件刷新后也没了，
 * 只靠句柄 / 内存 File 的话，「刷新后照片墙全空白」是必然结果。
 * 这里把图片字节本身存进 IndexedDB（视频太大不存），照片墙就能稳定显示。
 */
const BLOB_PREFIX = 'blob:';
const BLOB_MAX_COUNT = 400;
const BLOB_MAX_BYTES = 220 * 1024 * 1024;

function isVideoName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && VIDEO_EXT.has(name.slice(dot + 1).toLowerCase());
}

/** 把扫描到的图片字节写入 IndexedDB（超量即停，忽略配额错误） */
export async function cachePhotoFiles(files: Map<string, File> | null): Promise<void> {
  if (!files || files.size === 0) return;
  try {
    const db = await openDb();
    let bytes = 0;
    let n = 0;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const [path, file] of files) {
        if (n >= BLOB_MAX_COUNT || bytes > BLOB_MAX_BYTES) break;
        if (isVideoName(file.name)) continue;
        bytes += file.size;
        n += 1;
        store.put(file, BLOB_PREFIX + path);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    /* 配额不足时静默降级：仍可走句柄 / 内存路径 */
  }
}

export async function clearPhotoBlobCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const k of req.result as IDBValidKey[]) {
          if (typeof k === 'string' && k.startsWith(BLOB_PREFIX)) store.delete(k);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* 忽略 */
  }
}

/** 删除照片后清理对应的字节缓存，避免 IndexedDB 旧 blob 让照片墙继续显示 */
export async function removeCachedBlobs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      for (const p of paths) store.delete(BLOB_PREFIX + p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    /* 忽略 */
  }
}

export function persistIndex(index: PhotoIndex | null): void {
  writeIndex(index);
}

export async function removeStoredHandle(): Promise<void> {
  await dropHandle();
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}
