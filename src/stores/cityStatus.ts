import { create } from 'zustand';
import { useVisitLog } from './visitLog';

const KEY = 'ds.cityStatus.v1';

interface MarkStatusState {
  /** 去过（城市） */
  visited: string[];
  /** 去过（区县）——城市视图下按区县插小红旗 */
  visitedDistricts: string[];
  toggleVisited: (cityId: string) => void;
  toggleVisitedDistrict: (districtId: string) => void;
  isVisited: (cityId: string) => boolean;
  isVisitedDistrict: (districtId: string) => boolean;
}

function read(): { visited: string[]; visitedDistricts: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<{
        visited: string[];
        visitedDistricts: string[];
      }>;
      return {
        visited: Array.isArray(p.visited) ? p.visited : [],
        visitedDistricts: Array.isArray(p.visitedDistricts) ? p.visitedDistricts : [],
      };
    }
  } catch {
    /* 忽略损坏缓存 */
  }
  return { visited: [], visitedDistricts: [] };
}

function write(state: { visited: string[]; visitedDistricts: string[] }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 忽略存储失败 */
  }
}

const initial = read();

export const useCityStatus = create<MarkStatusState>((set, get) => ({
  visited: initial.visited,
  visitedDistricts: initial.visitedDistricts,

  toggleVisited: (cityId) => {
    set((s) => {
      const has = s.visited.includes(cityId);
      const next = {
        visited: has ? s.visited.filter((x) => x !== cityId) : [...s.visited, cityId],
        visitedDistricts: s.visitedDistricts,
      };
      // 每次标记「去过」都往时间线记一条（取消标记不清历史，历史由时间线面板管理）
      if (!has) useVisitLog.getState().logVisit('city', cityId);
      write(next);
      return next;
    });
  },

  toggleVisitedDistrict: (districtId) => {
    set((s) => {
      const has = s.visitedDistricts.includes(districtId);
      const next = {
        visited: s.visited,
        visitedDistricts: has
          ? s.visitedDistricts.filter((x) => x !== districtId)
          : [...s.visitedDistricts, districtId],
      };
      if (!has) useVisitLog.getState().logVisit('district', districtId);
      write(next);
      return next;
    });
  },

  isVisited: (cityId) => get().visited.includes(cityId),
  isVisitedDistrict: (districtId) => get().visitedDistricts.includes(districtId),
}));
