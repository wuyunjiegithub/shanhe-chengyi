import { create } from 'zustand';

/** 单张照片的图注：按照片墙条目 key（如 `p:<path>` / `s:<id>` / `cover`）落盘到本地 */
const KEY = 'ds.photoCaptions.v1';

interface CaptionsState {
  map: Record<string, string>;
  get: (key: string) => string;
  /** 写入图注；空串视为删除 */
  set: (key: string, text: string) => void;
  remove: (key: string) => void;
}

function read(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* 忽略：存储空间不足时不影响看图 */
  }
}

export const useCaptions = create<CaptionsState>((set, get) => ({
  map: read(),
  get: (key) => get().map[key] ?? '',
  set: (key, text) => {
    const trimmed = text.trim();
    const next = { ...get().map };
    if (trimmed) next[key] = trimmed;
    else delete next[key];
    write(next);
    set({ map: next });
  },
  remove: (key) => {
    const next = { ...get().map };
    delete next[key];
    write(next);
    set({ map: next });
  },
}));
