import { create } from 'zustand';

const KEY = 'ds.visits.v1';

export type VisitKind = 'city' | 'district';

export interface VisitRecord {
  /** 记录 id */
  id: string;
  kind: VisitKind;
  /** 城市 id 或区县 id */
  placeId: string;
  /** 到访时间（ms 时间戳） */
  at: number;
}

interface VisitLogState {
  records: VisitRecord[];
  /** 记录一次到访（标记「去过」时自动调用，也可在时间线里补录） */
  logVisit: (kind: VisitKind, placeId: string) => void;
  /** 记录一次到访（指定到访时间，用于区县抽屉里手动补录某次到访的具体日期） */
  logVisitAt: (kind: VisitKind, placeId: string, at: number) => void;
  /** 删除单条记录 */
  removeRecord: (id: string) => void;
  /** 清空时间线 */
  clearVisits: () => void;
}

function read(): VisitRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter(
      (r): r is VisitRecord =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as VisitRecord).id === 'string' &&
        ((r as VisitRecord).kind === 'city' || (r as VisitRecord).kind === 'district') &&
        typeof (r as VisitRecord).placeId === 'string' &&
        typeof (r as VisitRecord).at === 'number',
    );
  } catch {
    return [];
  }
}

function write(records: VisitRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* 忽略存储失败 */
  }
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `v-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 7)}`;
}

const initial = read();

export const useVisitLog = create<VisitLogState>((set) => ({
  records: initial,

  logVisit: (kind, placeId) =>
    set((s) => {
      const next = [...s.records, { id: nextId(), kind, placeId, at: Date.now() }];
      write(next);
      return { records: next };
    }),

  logVisitAt: (kind, placeId, at) =>
    set((s) => {
      const t = Number.isFinite(at) && at > 0 ? at : Date.now();
      const next = [...s.records, { id: nextId(), kind, placeId, at: t }];
      write(next);
      return { records: next };
    }),

  removeRecord: (id) =>
    set((s) => {
      const next = s.records.filter((r) => r.id !== id);
      write(next);
      return { records: next };
    }),

  clearVisits: () =>
    set(() => {
      write([]);
      return { records: [] };
    }),
}));

/** 某个地点（城市/区县）的去过次数 */
export function countVisits(records: VisitRecord[], kind: VisitKind, placeId: string): number {
  let n = 0;
  for (const r of records) {
    if (r.kind === kind && r.placeId === placeId) n += 1;
  }
  return n;
}

/** 某个地点最近一次到访时间（没有则 null） */
export function lastVisitAt(records: VisitRecord[], kind: VisitKind, placeId: string): number | null {
  let latest: number | null = null;
  for (const r of records) {
    if (r.kind === kind && r.placeId === placeId && (latest === null || r.at > latest)) latest = r.at;
  }
  return latest;
}
