/**
 * Android 系统相册只读桥（原生侧见 MediaBridge.kt）。
 *
 * 为什么需要它：WebView 里的 JS 拿不到 MediaStore，而手机端的照片绑定键是**相册名**
 * ——Android 的相册名就是照片所在目录名，相册之间平级、没有子相册，
 * 所以「在系统相册里建一个叫『淳安县』的相册」就等于把照片绑到了淳安县。
 *
 * 浏览器 / PC 上这个桥不存在，所有函数返回空结果，前端按「没有相册」优雅降级。
 */

export interface AndroidAlbum {
  name: string;
  count: number;
}

export interface AndroidPhoto {
  id: number;
  name: string;
  path: string;
  mtime: number;
  width: number;
  height: number;
  mime: string;
}

interface MediaBridgeApi {
  hasPermission(): boolean;
  requestPermission(): boolean;
  listAlbums(): string;
  listAlbumPhotos(album: string): string;
}

function bridge(): MediaBridgeApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ShanheMedia?: MediaBridgeApi };
  return w.ShanheMedia ?? null;
}

export function hasMediaBridge(): boolean {
  return Boolean(bridge());
}

export function hasMediaPermission(): boolean {
  const b = bridge();
  if (!b) return false;
  try {
    return b.hasPermission();
  } catch {
    return false;
  }
}

/** 拉起系统权限弹窗（首次会弹出）；返回当前是否已具备权限 */
export function requestMediaPermission(): boolean {
  const b = bridge();
  if (!b) return false;
  try {
    return b.requestPermission();
  } catch {
    return false;
  }
}

function parse<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function listAndroidAlbums(): AndroidAlbum[] {
  const b = bridge();
  if (!b) return [];
  try {
    return parse<AndroidAlbum>(b.listAlbums()).filter((a) => a && typeof a.name === 'string');
  } catch {
    return [];
  }
}

export function listAndroidAlbumPhotos(album: string): AndroidPhoto[] {
  const b = bridge();
  if (!b || !album) return [];
  try {
    return parse<AndroidPhoto>(b.listAlbumPhotos(album)).filter(
      (p) => p && typeof p.path === 'string' && p.path.length > 0,
    );
  } catch {
    return [];
  }
}
