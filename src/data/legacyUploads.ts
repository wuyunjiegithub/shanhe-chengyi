/**
 * 旧版「照片墙手动上传」数据迁移
 * --------------------------------
 * v1.1 之前，照片墙的上传字节藏在应用自己的 IndexedDB（ds-wall-uploads）里，
 * 用户在磁盘上找不到。现在上传直接写进照片根目录的「省/市/区县」文件夹。
 * 本模块用于把旧数据读出来，交给 photoLib.uploadTo 落到正确位置后清库。
 */

const DB_NAME = 'ds-wall-uploads';
const DB_STORE = 'media';

export interface LegacyUpload {
  id: string;
  scope: 'city' | 'district';
  placeId: string;
  name: string;
  blob: Blob;
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

/** 读出全部旧上传（含字节）；库不存在 / 打不开时返回空数组 */
export async function readLegacyUploads(): Promise<LegacyUpload[]> {
  try {
    const db = await openDb();
    const all = await new Promise<LegacyUpload[]>((resolve) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve((req.result as LegacyUpload[]) ?? []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return all.filter((u) => u && u.blob && u.scope && u.placeId);
  } catch {
    return [];
  }
}

/** 迁移完成后清空旧库 */
export async function clearLegacyUploads(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    /* 忽略 */
  }
}
