/**
 * 照片磁盘后端
 * ----------
 * 「照片放在本地文件夹里」是本产品的基本约定：按 省 / 市 / 区县 三级目录摆放。
 * 本文件把「选根目录 / 写文件 / 删文件 / 递归扫描」抽象成一套接口，按运行环境给出实现：
 *
 * - FsaDisk（Chrome / Edge 等桌面浏览器）：File System Access API。
 *   目录句柄存 IndexedDB（刷新免重新选择）；上传 / 删除需要在用户手势内取得
 *   readwrite 授权（Chrome 会把授权状态连同句柄一起持久化）。
 * - TauriDisk（Windows / macOS / Linux 套壳，以及 Android）：tauri-plugin-fs +
 *   tauri-plugin-dialog。根目录是真实路径（localStorage 记住），读写删除都走
 *   原生文件系统，播放用 convertFileSrc 直接出流，不占内存。
 * - 两者皆无（kind = 'none'）：上传 / 删除不可用；绑定目录仍可退化成
 *   <input webkitdirectory> 一次性导入（见 photoLib.bindFiles）。
 *
 * 测试可用 window.__diskOverride 注入内存后端，免去真实文件系统交互。
 */

import {
  exists as tauriExists,
  mkdir as tauriMkdir,
  readDir as tauriReadDir,
  readFile as tauriReadFile,
  remove as tauriRemove,
  writeFile as tauriWriteFile,
} from '@tauri-apps/plugin-fs';
import { open as tauriOpenDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pictureDir } from '@tauri-apps/api/path';
import { getStoredHandle, putHandle } from './photoLibrary';

export type DiskKind = 'fsa' | 'tauri' | 'none';

/** 扫描命中的一条媒体（path 相对根目录，如 浙江省/杭州市/淳安县/001.jpg） */
export interface DiskHit {
  path: string;
  name: string;
  /** 有字节的给出 File（图片探测 / IndexedDB 缓存用）；Tauri 视频为 null（播放走 directUrl） */
  file: File | null;
  mtime: number;
}

export interface PhotoDisk {
  readonly kind: DiskKind;
  /** 根目录是否已配置（已绑定 / 已记住路径） */
  hasRoot(): Promise<boolean>;
  /** 根目录显示名 */
  rootLabel(): Promise<string>;
  /** 确保根目录可用；未配置时弹出系统选择框（需在用户手势中调用）。取消时返回 false */
  ensureRoot(): Promise<boolean>;
  /** 重新选择根目录（换绑），总是弹出选择框 */
  repickRoot(): Promise<boolean>;
  /** 把文件写进 relDir（相对根目录的「省/市/区县」），返回写入的相对路径 */
  writeFiles(relDir: string, files: File[]): Promise<string[]>;
  /** 删除相对路径对应的真实文件，返回成功删除数 */
  deleteFiles(paths: string[]): Promise<number>;
  /** 递归扫描根目录（最多 4 层，跳过点号开头目录） */
  scan(): Promise<DiskHit[]>;
  /** 直接可播放的地址（Tauri 用 convertFileSrc；其余返回 null，走照片库解析） */
  directUrl(path: string): string | null;
  /** 读单张照片的字节（供把本地照片复制进游记图片库等需要 Blob 的场景） */
  readFile(path: string): Promise<Blob | null>;
}

/* ---------------- 公共工具 ---------------- */

const MAX_DEPTH = 4;

/** 扩展名 → MIME（Tauri 侧读字节后重建 File 用） */
function mimeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 重名避让：001.jpg → 001 (1).jpg → 001 (2).jpg … */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 999; i += 1) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** 受限并发执行（Tauri 扫描读图片字节用，避免同时铺满内存） */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------- File System Access API（桌面浏览器） ---------------- */

class FsaDisk implements PhotoDisk {
  readonly kind = 'fsa' as const;

  async hasRoot(): Promise<boolean> {
    return (await getStoredHandle()) !== null;
  }

  async rootLabel(): Promise<string> {
    const handle = await getStoredHandle();
    return handle?.name ?? '本地照片';
  }

  async ensureRoot(): Promise<boolean> {
    const handle = await getStoredHandle();
    if (handle) return true;
    // 首次上传：弹出选择框，直接要 readwrite（之后上传 / 删除都不用再要权限）
    const picked = await window.showDirectoryPicker!({ mode: 'readwrite' });
    await putHandle(picked);
    return true;
  }

  async repickRoot(): Promise<boolean> {
    const picked = await window.showDirectoryPicker!({ mode: 'readwrite' });
    await putHandle(picked);
    return true;
  }

  async writeFiles(relDir: string, files: File[]): Promise<string[]> {
    const root = await getStoredHandle();
    if (!root) throw new Error('未绑定照片目录');
    const ok = await ensureWritePermission(root);
    if (!ok) throw new Error('NEED_WRITE_PERMISSION');
    // 逐级创建 省/市/区县 目录
    let dir: FileSystemDirectoryHandle = root;
    for (const seg of relDir.split('/').filter(Boolean)) {
      dir = await dir.getDirectoryHandle(seg, { create: true });
    }
    const taken = new Set<string>();
    for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) {
      taken.add(name);
    }
    const written: string[] = [];
    for (const file of files) {
      const name = uniqueName(file.name, taken);
      const fh = await dir.getFileHandle(name, { create: true });
      const writable = await fh.createWritable();
      try {
        await writable.write(file);
        await writable.close();
      } catch (err) {
        try {
          await writable.abort();
        } catch {
          /* 已失败的文件句柄忽略 */
        }
        throw err;
      }
      taken.add(name);
      written.push(`${relDir}/${name}`);
    }
    return written;
  }

  async deleteFiles(paths: string[]): Promise<number> {
    const root = await getStoredHandle();
    if (!root) throw new Error('未绑定照片目录');
    const ok = await ensureWritePermission(root);
    if (!ok) throw new Error('NEED_WRITE_PERMISSION');
    // 按目录分组，减少句柄寻览次数
    const byDir = new Map<string, string[]>();
    for (const p of paths) {
      const segs = p.split('/').filter(Boolean);
      const name = segs.pop();
      if (!name) continue;
      const dir = segs.join('/');
      byDir.set(dir, [...(byDir.get(dir) ?? []), name]);
    }
    let removed = 0;
    for (const [dir, names] of byDir) {
      let handle: FileSystemDirectoryHandle = root;
      let reachable = true;
      for (const seg of dir.split('/').filter(Boolean)) {
        try {
          handle = await handle.getDirectoryHandle(seg);
        } catch {
          reachable = false;
          break;
        }
      }
      if (!reachable) continue;
      for (const name of names) {
        try {
          await handle.removeEntry(name);
          removed += 1;
        } catch {
          /* 文件可能已被外部删除 */
        }
      }
    }
    return removed;
  }

  async scan(): Promise<DiskHit[]> {
    const root = await getStoredHandle();
    if (!root) throw new Error('未绑定照片目录');
    const hits: DiskHit[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (name.startsWith('.')) continue;
        if (handle.kind === 'file') {
          if (!isMediaName(name)) continue;
          const path = prefix ? `${prefix}/${name}` : name;
          const file = await (handle as FileSystemFileHandle).getFile();
          hits.push({ path, name, file, mtime: file.lastModified || 0 });
        } else if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name, depth + 1);
        }
      }
    };
    await walk(root, '', 1);
    return hits;
  }

  directUrl(): string | null {
    return null;
  }

  async readFile(path: string): Promise<Blob | null> {
    const root = await getStoredHandle();
    if (!root) return null;
    const segs = path.split('/').filter(Boolean);
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
}

/** 取（或在用户手势内申请）目录写权限 */
async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
  };
  try {
    const q = await h.queryPermission?.({ mode: 'readwrite' });
    if (q === 'granted') return true;
    const r = await h.requestPermission?.({ mode: 'readwrite' });
    return r === 'granted';
  } catch {
    return false;
  }
}

/* ---------------- Tauri（桌面 / 移动套壳） ---------------- */

const TAURI_ROOT_KEY = 'ds.photoLib.tauriRoot.v1';

/** 是否跑在 Android 套壳里（WebView UA 含 Android） */
export function isAndroidShell(): boolean {
  return /android/i.test(navigator.userAgent);
}

function joinTauri(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const clean = rel.replace(/[\\/]+/g, sep);
  return root.endsWith(sep) ? root + clean : root + sep + clean;
}

class TauriDisk implements PhotoDisk {
  readonly kind = 'tauri' as const;
  private root: string | null = null;

  constructor() {
    try {
      this.root = localStorage.getItem(TAURI_ROOT_KEY);
    } catch {
      this.root = null;
    }
  }

  private persist(root: string | null): void {
    this.root = root;
    try {
      if (root) localStorage.setItem(TAURI_ROOT_KEY, root);
      else localStorage.removeItem(TAURI_ROOT_KEY);
    } catch {
      /* 忽略 */
    }
  }

  async hasRoot(): Promise<boolean> {
    return Boolean(this.root) && (await tauriExists(this.root!));
  }

  async rootLabel(): Promise<string> {
    if (!this.root) return '照片目录';
    const segs = this.root.split(/[\\/]/).filter(Boolean);
    return segs[segs.length - 1] ?? '照片目录';
  }

  async ensureRoot(): Promise<boolean> {
    if (await this.hasRoot()) return true;
    // 移动端（Android 套壳）：没绑过根目录时，直接落到系统相册目录
    // Pictures/山河城邑，省掉「选目录」这一步——相册选图即上传，所见即所得
    if (isAndroidShell()) {
      try {
        const base = await pictureDir();
        if (base) {
          const root = `${base.replace(/[\\/]+$/, '')}/山河城邑`;
          await tauriMkdir(root, { recursive: true });
          this.persist(root);
          return true;
        }
      } catch {
        /* 落相册目录失败则退回手动选择 */
      }
    }
    return this.repickRoot();
  }

  async repickRoot(): Promise<boolean> {
    const picked = await tauriOpenDialog({
      directory: true,
      title: '选择照片根目录（按 省/市/区县 摆放照片）',
    });
    if (!picked || typeof picked !== 'string') return false;
    if (!(await tauriExists(picked))) return false;
    this.persist(picked);
    return true;
  }

  async writeFiles(relDir: string, files: File[]): Promise<string[]> {
    if (!this.root) throw new Error('未选择照片目录');
    const dir = joinTauri(this.root, relDir);
    await tauriMkdir(dir, { recursive: true });
    const written: string[] = [];
    for (const file of files) {
      // 相册导出常有同名文件（IMG_0001.jpg），逐个避让：001.jpg → 001 (1).jpg
      let name = file.name;
      let n = 1;
      while (await tauriExists(joinTauri(dir, name))) {
        const dot = file.name.lastIndexOf('.');
        const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
        const ext = dot > 0 ? file.name.slice(dot) : '';
        name = `${stem} (${n})${ext}`;
        n += 1;
      }
      await tauriWriteFile(joinTauri(dir, name), new Uint8Array(await file.arrayBuffer()));
      written.push(`${relDir}/${name}`);
    }
    return written;
  }

  async deleteFiles(paths: string[]): Promise<number> {
    if (!this.root) throw new Error('未选择照片目录');
    let removed = 0;
    for (const p of paths) {
      try {
        await tauriRemove(joinTauri(this.root, p));
        removed += 1;
      } catch {
        /* 文件可能已被外部删除 */
      }
    }
    return removed;
  }

  async scan(): Promise<DiskHit[]> {
    if (!this.root) throw new Error('未选择照片目录');
    const hits: DiskHit[] = [];
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) return;
      let entries: Awaited<ReturnType<typeof tauriReadDir>>;
      try {
        entries = await tauriReadDir(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory) await walk(joinTauri(dir, e.name), path, depth + 1);
        else if (e.isFile && isMediaName(e.name)) hits.push({ path, name: e.name, file: null, mtime: 0 });
      }
    };
    await walk(this.root, '', 1);
    // 图片读字节（画幅探测 + IndexedDB 缓存用）；视频只登记，播放走 directUrl
    return pooled(hits, 8, async (h) => {
      if (kindOfName(h.name) === 'video') return h;
      try {
        const bytes = await tauriReadFile(joinTauri(this.root!, h.path));
        return { ...h, file: new File([bytes], h.name, { type: mimeOf(h.name) }) };
      } catch {
        return h;
      }
    });
  }

  directUrl(path: string): string | null {
    if (!this.root) return null;
    try {
      return convertFileSrc(joinTauri(this.root, path));
    } catch {
      return null;
    }
  }

  async readFile(path: string): Promise<Blob | null> {
    if (!this.root) return null;
    try {
      const bytes = await tauriReadFile(joinTauri(this.root, path));
      const name = path.split('/').pop() ?? 'photo';
      return new File([bytes], name, { type: mimeOf(name) });
    } catch {
      return null;
    }
  }
}

/* ---------------- 无后端 ---------------- */

class NoneDisk implements PhotoDisk {
  readonly kind = 'none' as const;

  async hasRoot(): Promise<boolean> {
    return false;
  }

  async rootLabel(): Promise<string> {
    return '—';
  }

  async ensureRoot(): Promise<boolean> {
    return false;
  }

  async repickRoot(): Promise<boolean> {
    return false;
  }

  async writeFiles(): Promise<string[]> {
    throw new Error('当前环境不支持写入本地文件夹');
  }

  async deleteFiles(): Promise<number> {
    throw new Error('当前环境不支持删除本地文件');
  }

  async scan(): Promise<DiskHit[]> {
    throw new Error('当前环境不支持访问本地目录');
  }

  directUrl(): string | null {
    return null;
  }

  async readFile(): Promise<Blob | null> {
    return null;
  }
}

/* ---------------- 环境探测 ---------------- */

function isTauriEnv(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** 媒体文件名判定（与照片库同一套扩展名表） */
export function isMediaName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return (
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(ext) ||
    ['mp4', 'webm', 'mov', 'm4v'].includes(ext)
  );
}

/** 文件名 → 媒体类型 */
export function kindOfName(name: string): 'image' | 'video' | 'animated' {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (ext === 'gif') return 'animated';
  return 'image';
}

export function detectDisk(): PhotoDisk {
  if (isTauriEnv()) return new TauriDisk();
  if (isDirectoryPickerSupported()) return new FsaDisk();
  return new NoneDisk();
}

let cachedDisk: PhotoDisk | null = null;

/** 当前磁盘后端（测试可经 window.__diskOverride 注入内存实现） */
export function getDisk(): PhotoDisk {
  const w = typeof window !== 'undefined' ? (window as Window & { __diskOverride?: PhotoDisk }) : undefined;
  if (w?.__diskOverride) return w.__diskOverride;
  if (!cachedDisk) cachedDisk = detectDisk();
  return cachedDisk;
}
