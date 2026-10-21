import { create } from 'zustand';
import { deleteImage, imageUrl, saveImage } from '../data/imageStore';

/**
 * 自定义背景图覆盖层
 * ------------------
 * 内容 JSON 里的封面图是内容生成时带的（AI 生成 / 占位），用户往往想换成自己拍的照片。
 * 这里做一层「按地点覆盖」：
 * - 索引（地点 key → 图片 id）存 localStorage，体积极小；
 * - 图片字节存 IndexedDB（复用游记图片库 imageStore），刷新后依然生效；
 * - 渲染时 BgImage 优先用覆盖图，没有就用内容里的原图。
 *
 * key 的命名：`city:<id>`、`district:<id>`、`spot:<id>`、`food:district:<id>:<名称>`、`food:city:<id>:<名称>`
 */

const STORAGE_KEY = 'ds.backgrounds.v1';

export type BgScope = 'city' | 'district' | 'spot' | 'food';

export function bgKey(scope: BgScope, ...parts: string[]): string {
  return [scope, ...parts].join(':');
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 配额不足时忽略：覆盖关系丢了仍能显示原图 */
  }
}

interface BgState {
  /** 地点 key → 图片 id */
  ids: Record<string, string>;
  /** 地点 key → 可直接给 <img> 用的 object URL */
  urls: Record<string, string>;
  ready: boolean;
  hydrate: () => Promise<void>;
  /** 上传一张自定义背景图 */
  setImage: (key: string, file: Blob) => Promise<void>;
  /** 恢复内容自带的默认背景 */
  clear: (key: string) => Promise<void>;
}

export const useBackgrounds = create<BgState>((set, get) => ({
  ids: {},
  urls: {},
  ready: false,

  hydrate: async () => {
    if (get().ready) return;
    const ids = readMap();
    const urls: Record<string, string> = {};
    await Promise.all(
      Object.entries(ids).map(async ([key, id]) => {
        const url = await imageUrl(id).catch(() => null);
        if (url) urls[key] = url;
      }),
    );
    set({ ids, urls, ready: true });
  },

  setImage: async (key, file) => {
    const id = await saveImage(file, key);
    const url = await imageUrl(id);
    if (!url) return;
    const prev = get().ids[key];
    const ids = { ...get().ids, [key]: id };
    writeMap(ids);
    set({ ids, urls: { ...get().urls, [key]: url } });
    if (prev) void deleteImage(prev).catch(() => undefined);
  },

  clear: async (key) => {
    const prev = get().ids[key];
    if (!prev) return;
    const ids = { ...get().ids };
    delete ids[key];
    const urls = { ...get().urls };
    delete urls[key];
    writeMap(ids);
    set({ ids, urls });
    void deleteImage(prev).catch(() => undefined);
  },
}));

/** 取某个地点的自定义背景 URL（没有则为 undefined） */
export function useBgUrl(key: string | undefined): string | undefined {
  return useBackgrounds((s) => (key ? s.urls[key] : undefined));
}
