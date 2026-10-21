/**
 * 游记图片的本地存储（IndexedDB）。
 * 图片以 Blob 原样入库，读取时生成 ObjectURL 供 <img> 使用；
 * 元数据（图片 id 列表）由 travelNotes store 存在 localStorage。
 */

const DB_NAME = 'ds-travel-images';
const DB_VERSION = 1;
const STORE = 'images';

export interface StoredImage {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `img-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 存一张图片，返回图片 id（失败抛错，由调用方提示） */
export async function saveImage(file: Blob, name: string): Promise<string> {
  const db = await openDb();
  try {
    const id = nextId();
    const rec: StoredImage = {
      id,
      blob: file,
      name,
      type: file.type || 'application/octet-stream',
      createdAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, 'readwrite').put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('图片写入失败'));
    });
    return id;
  } finally {
    db.close();
  }
}

/** 读一张图片的 Blob（不存在返回 null） */
export async function readImage(id: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const req = tx(db, 'readonly').get(id);
      req.onsuccess = () => {
        const rec = req.result as StoredImage | undefined;
        resolve(rec ? rec.blob : null);
      };
      req.onerror = () => reject(req.error ?? new Error('图片读取失败'));
    });
  } finally {
    db.close();
  }
}

/** 删除一张图片（不存在时静默） */
export async function deleteImage(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('图片删除失败'));
    });
  } finally {
    db.close();
  }
}

/** 批量删除（用于删除游记时清理图片） */
export async function deleteImages(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => deleteImage(id).catch(() => undefined)));
}

/** 读取并生成 ObjectURL；调用方负责 revoke */
export async function imageUrl(id: string): Promise<string | null> {
  const blob = await readImage(id);
  return blob ? URL.createObjectURL(blob) : null;
}
