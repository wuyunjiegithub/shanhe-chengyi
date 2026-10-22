import { create } from 'zustand';

/**
 * 单张照片的「自定义名称」：覆盖照片墙条目默认显示名（本地照片默认是文件名去扩展名，
 * 景点 / 封面图默认是地点名）。按照片墙条目 key（如 `p:<path>` / `s:<id>` / `cover`）落盘到本地。
 * 仅影响显示，不改动磁盘上的真实文件名。空串视为删除（还原默认名）。
 */
const KEY = 'ds.photoNames.v1';

interface PhotoNamesState {
  map: Record<string, string>;
  get: (key: string) => string;
  /** 写入自定义名称；空串视为删除（还原默认名） */
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

export const usePhotoNames = create<PhotoNamesState>((set, get) => ({
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
