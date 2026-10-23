/**
 * Android 系统相册只读桥
 * ----------------------
 * 手机端的照片绑定键是**相册名**：Android 的相册名就是照片所在目录名，
 * 且相册之间平级、没有子相册，所以在系统相册里建一个叫「淳安县」的相册，
 * App 里淳安县就有照片——不需要导入、不需要复制、也不需要理解目录结构。
 *
 * 原生侧见 `src-tauri/src/android_media.rs`（JNI 查 MediaStore，
 * 必须跑在 WebView 主线程，所以命令都是 async + 主线程消息队列）。
 * 浏览器 / PC 上没有这座桥，所有函数返回空结果，前端按「没有相册」优雅降级。
 */

import { invoke } from '@tauri-apps/api/core';
import { isAndroidShell } from './photoDisk';

export interface AndroidAlbum {
  name: string;
  count: number;
}

export interface AndroidPhoto {
  id: number;
  /** 所属相册名（= 照片所在目录名） */
  bucket: string;
  name: string;
  /** 文件系统路径；部分新机型为空，此时用 uri 兜底 */
  path: string;
  /** content://media/external/images/media/<id> */
  uri: string;
  /** 毫秒时间戳 */
  mtime: number;
  width: number;
  height: number;
  mime: string;
}

function hasTauriInternals(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/** 只有 Android 套壳里这座桥才存在 */
export function hasMediaBridge(): boolean {
  return isAndroidShell() && hasTauriInternals();
}

/** 已授权读相册（未授权时查相册会返回空） */
export async function hasMediaPermission(): Promise<boolean> {
  if (!hasMediaBridge()) return false;
  try {
    return await invoke<boolean>('media_permission_state');
  } catch {
    return false;
  }
}

/**
 * 拉起系统权限弹窗。弹窗是异步的：用户在教育弹窗里点「允许」后，
 * 要等 `visibilitychange`（回到 App）再查一次才知道结果。
 */
export async function requestMediaPermission(): Promise<boolean> {
  if (!hasMediaBridge()) return false;
  try {
    return await invoke<boolean>('media_request_permission');
  } catch {
    return false;
  }
}

/** 全部相册（按张数降序） */
export async function listAndroidAlbums(): Promise<AndroidAlbum[]> {
  if (!hasMediaBridge()) return [];
  try {
    const list = await invoke<AndroidAlbum[]>('media_list_albums');
    return list.filter((a) => a && typeof a.name === 'string' && a.name.length > 0);
  } catch {
    return [];
  }
}

/** 全量照片（带所属相册名；建索引用，一次查询拉完） */
export async function allAndroidPhotos(): Promise<AndroidPhoto[]> {
  if (!hasMediaBridge()) return [];
  try {
    const list = await invoke<AndroidPhoto[]>('media_all_photos');
    return list.filter((p) => p && typeof p.uri === 'string' && p.uri.length > 0);
  } catch {
    return [];
  }
}

/** 单个相册的照片 */
export async function listAndroidAlbumPhotos(album: string): Promise<AndroidPhoto[]> {
  if (!hasMediaBridge() || !album) return [];
  try {
    const list = await invoke<AndroidPhoto[]>('media_album_photos', { album });
    return list.filter((p) => p && typeof p.uri === 'string' && p.uri.length > 0);
  } catch {
    return [];
  }
}

/**
 * 读一张相册照片的字节（DATA 路径缺失时的兜底，也用于把照片复制进游记）。
 * 原生侧返回 ArrayBuffer，这里包成 Blob。
 */
export async function readAndroidPhoto(uri: string): Promise<Blob | null> {
  if (!hasMediaBridge() || !uri) return null;
  try {
    const buf = await invoke<ArrayBuffer>('media_photo_bytes', { uri });
    if (!buf || buf.byteLength === 0) return null;
    return new Blob([buf], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}
