import { create } from 'zustand';
import { deleteImages } from '../data/imageStore';

const KEY = 'ds.travelNotes.v1';

export type NotePlaceKind = 'city' | 'district';

export interface TravelNote {
  id: string;
  title: string;
  /** 正文（纯文本，空行分段） */
  body: string;
  /** 关联地点（可选） */
  placeKind: NotePlaceKind | null;
  placeId: string | null;
  /** 地点名称快照：地点数据变动后列表里仍可读 */
  placeName: string;
  /** 图片 id 列表（Blob 存在 IndexedDB） */
  images: string[];
  createdAt: number;
  updatedAt: number;
}

interface TravelNotesState {
  notes: TravelNote[];
  createNote: (draft: {
    title: string;
    body: string;
    placeKind: NotePlaceKind | null;
    placeId: string | null;
    placeName: string;
    images: string[];
  }) => TravelNote;
  updateNote: (
    id: string,
    patch: Partial<Pick<TravelNote, 'title' | 'body' | 'placeKind' | 'placeId' | 'placeName' | 'images'>>,
  ) => void;
  removeNote: (id: string) => void;
}

/**
 * 游记默认标题：全应用唯一标准。
 * 之前 createNote 写「无题游记」、updateNote 不兜底、预览显示「（无标题）」，
 * 于是同一篇空标题游记在不同位置显示成两种说法。现在统一到这里。
 */
export const UNTITLED_NOTE_TITLE = '无题游记';

/** 空 / 纯空白标题一律归到这个标准值，保证各处显示一致 */
function normalizeTitle(title: string): string {
  return title.trim() || UNTITLED_NOTE_TITLE;
}

function read(): TravelNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .filter(
        (n): n is TravelNote =>
          typeof n === 'object' &&
          n !== null &&
          typeof (n as TravelNote).id === 'string' &&
          typeof (n as TravelNote).title === 'string' &&
          typeof (n as TravelNote).body === 'string' &&
          Array.isArray((n as TravelNote).images),
      )
      // 迁移旧数据：历史上被写成空串的标题，读入时统一成标准默认值
      .map((n) => ({ ...n, title: normalizeTitle(n.title) }));
  } catch {
    return [];
  }
}

function write(notes: TravelNote[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    /* 忽略存储失败（多为配额溢出，图片已在 IndexedDB，不会一起丢） */
  }
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `note-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
}

const initial = read();

export const useTravelNotes = create<TravelNotesState>((set) => ({
  notes: initial,

  createNote: (draft) => {
    const now = Date.now();
    const note: TravelNote = {
      id: nextId(),
      title: normalizeTitle(draft.title),
      body: draft.body,
      placeKind: draft.placeKind,
      placeId: draft.placeId,
      placeName: draft.placeName,
      images: draft.images,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => {
      const next = [note, ...s.notes];
      write(next);
      return { notes: next };
    });
    return note;
  },

  updateNote: (id, patch) =>
    set((s) => {
      // 自动保存会把「用户清空标题」的 '' 直接写回；若不兜底，
      // 列表/预览就会退回各自的历史默认文案，出现「一会无标题、一会无题游记」。
      const safe = patch.title !== undefined ? { ...patch, title: normalizeTitle(patch.title) } : patch;
      const next = s.notes.map((n) => (n.id === id ? { ...n, ...safe, updatedAt: Date.now() } : n));
      write(next);
      return { notes: next };
    }),

  removeNote: (id) =>
    set((s) => {
      const target = s.notes.find((n) => n.id === id);
      const next = s.notes.filter((n) => n.id !== id);
      write(next);
      // 游记的图片随游记一起清理，避免 IndexedDB 里留孤儿
      if (target && target.images.length > 0) void deleteImages(target.images);
      return { notes: next };
    }),
}));
