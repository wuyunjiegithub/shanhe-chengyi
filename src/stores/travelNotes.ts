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

function read(): TravelNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter(
      (n): n is TravelNote =>
        typeof n === 'object' &&
        n !== null &&
        typeof (n as TravelNote).id === 'string' &&
        typeof (n as TravelNote).title === 'string' &&
        typeof (n as TravelNote).body === 'string' &&
        Array.isArray((n as TravelNote).images),
    );
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
      title: draft.title.trim() || '无题游记',
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
      const next = s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
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
