import { create } from 'zustand';
import type { Favorites } from '../data/types';
import { staticRepository } from '../data/staticRepository';

const RECENT_KEY = 'ds.recent.v1';

export type LeafCard =
  | { kind: 'spot'; id: string }
  | { kind: 'food'; districtId: string; name: string }
  | null;

export interface PhotoWallState {
  scope: 'city' | 'district';
  id: string;
  title: string;
}

/** 从区县抽屉/城市面板跳转写游记时携带的预置地点 */
export interface TravelPrefill {
  kind: 'city' | 'district';
  id: string;
  name: string;
}

interface UiState {
  drawerOpen: boolean;
  favorites: Favorites;
  recent: string[];
  favoritesOpen: boolean;
  timelineOpen: boolean;
  travelOpen: boolean;
  searchOpen: boolean;
  dataPanelOpen: boolean;
  settingsOpen: boolean;
  leafCard: LeafCard;
  toast: string | null;
  photoWall: PhotoWallState | null;
  travelPrefill: TravelPrefill | null;
  /** 移动端「选择城市 / 区县」全屏面板（桌面有左侧索引，看不到这个按钮） */
  districtPickerOpen: boolean;

  openDrawer: () => void;
  closeDrawer: () => void;
  hydrateFavorites: (f: Favorites) => void;
  replaceFavorites: (f: Favorites) => void;
  toggleFavorite: (kind: 'district' | 'spot' | 'city', id: string) => void;
  pushRecent: (q: string) => void;
  clearRecent: () => void;
  setSearchOpen: (open: boolean) => void;
  openLeaf: (card: LeafCard) => void;
  toggleFavoritesPanel: (open?: boolean) => void;
  toggleTimelinePanel: (open?: boolean) => void;
  toggleTravelPanel: (open?: boolean) => void;
  openTravelWithPlace: (prefill: TravelPrefill) => void;
  setTravelPrefill: (prefill: TravelPrefill | null) => void;
  toggleDataPanel: (open?: boolean) => void;
  toggleSettings: (open?: boolean) => void;
  setDistrictPickerOpen: (open: boolean) => void;
  openPhotoWall: (state: PhotoWallState) => void;
  closePhotoWall: () => void;
  showToast: (msg: string) => void;
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

let toastTimer: number | null = null;

export const useUi = create<UiState>((set, get) => ({
  drawerOpen: false,
  favorites: { districts: [], spots: [], cities: [] },
  recent: readRecent(),
  favoritesOpen: false,
  timelineOpen: false,
  travelOpen: false,
  searchOpen: false,
  dataPanelOpen: false,
  settingsOpen: false,
  leafCard: null,
  toast: null,
  photoWall: null,
  travelPrefill: null,
  districtPickerOpen: false,

  openDrawer: () => set({ drawerOpen: true, favoritesOpen: false }),
  closeDrawer: () => set({ drawerOpen: false, leafCard: null }),

  hydrateFavorites: (favorites) => set({ favorites }),

  replaceFavorites: (favorites) => {
    set({ favorites });
    void staticRepository.saveFavorites(favorites);
  },

  toggleFavorite: (kind, id) => {
    const { favorites } = get();
    const key = kind === 'district' ? 'districts' : kind === 'city' ? 'cities' : 'spots';
    const list = favorites[key];
    const next: Favorites = {
      ...favorites,
      [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    };
    set({ favorites: next });
    void staticRepository.saveFavorites(next);
    const added = next[key].length > list.length;
    const label = kind === 'district' ? '区县' : kind === 'city' ? '城市' : '景点';
    get().showToast(added ? `已加入收藏 · ${label}` : '已取消收藏');
  },

  pushRecent: (q) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const next = [trimmed, ...get().recent.filter((x) => x !== trimmed)].slice(0, 3);
    set({ recent: next });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* 忽略存储失败 */
    }
  },

  clearRecent: () => {
    set({ recent: [] });
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      /* 忽略存储失败 */
    }
  },

  setSearchOpen: (searchOpen) => set({ searchOpen }),

  openLeaf: (leafCard) => set({ leafCard }),

  openPhotoWall: (photoWall) => set({ photoWall, favoritesOpen: false, settingsOpen: false }),
  closePhotoWall: () => set({ photoWall: null }),

  // 注意：打开任何模态面板都不动 drawerOpen —— 模态的 z-index 本就高于抽屉，
  // 会整块盖住它；关闭模态后抽屉自然露出来，用户仍停在下钻前的区县详情。
  // （早期版本在这里把抽屉一起关掉，结果从淳安县打开游记再关闭，界面掉回杭州市。）
  toggleFavoritesPanel: (open) =>
    set((s) => ({
      favoritesOpen: open ?? !s.favoritesOpen,
      timelineOpen: false,
      travelOpen: false,
      dataPanelOpen: false,
      settingsOpen: false,
      leafCard: null,
    })),

  toggleTimelinePanel: (open) =>
    set((s) => ({
      timelineOpen: open ?? !s.timelineOpen,
      favoritesOpen: false,
      travelOpen: false,
      dataPanelOpen: false,
      settingsOpen: false,
      leafCard: null,
    })),

  toggleTravelPanel: (open) =>
    set((s) => ({
      travelOpen: open ?? !s.travelOpen,
      favoritesOpen: false,
      timelineOpen: false,
      dataPanelOpen: false,
      settingsOpen: false,
      leafCard: null,
      travelPrefill: null,
    })),

  openTravelWithPlace: (prefill) =>
    set({
      travelOpen: true,
      travelPrefill: prefill,
      favoritesOpen: false,
      timelineOpen: false,
      dataPanelOpen: false,
      settingsOpen: false,
      leafCard: null,
    }),

  setTravelPrefill: (travelPrefill) => set({ travelPrefill }),

  toggleDataPanel: (open) =>
    set((s) => ({
      dataPanelOpen: open ?? !s.dataPanelOpen,
      favoritesOpen: false,
      searchOpen: false,
      settingsOpen: false,
      leafCard: null,
    })),

  toggleSettings: (open) =>
    set((s) => ({
      settingsOpen: open ?? !s.settingsOpen,
      favoritesOpen: false,
      searchOpen: false,
      dataPanelOpen: false,
      leafCard: null,
    })),

  setDistrictPickerOpen: (districtPickerOpen) => set({ districtPickerOpen }),

  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 2400);
  },
}));
