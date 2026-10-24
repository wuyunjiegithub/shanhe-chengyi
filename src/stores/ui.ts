import { create } from 'zustand';
import type { Favorites } from '../data/types';
import { staticRepository } from '../data/staticRepository';
import { isVisitedStyle } from '../scene/markerArt';
import type { VisitedStyle } from '../scene/markerArt';

const RECENT_KEY = 'ds.recent.v1';
const MARKER_STYLE_KEY = 'ds.markerStyle.v1';
/** 地图图层开关（地形 / 天气）——用户明确要求「切换后下次打开 App 还是上次的设置」 */
const LAYERS_KEY = 'ds.layers.v1';

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
  /**
   * 移动端城市概览 / 区县详情是否全屏。
   * 默认 false = 半屏贴底，上半屏留给地图，好继续点选别的区县；
   * 点面板上的「全屏」按钮才铺满，看完再点「退出全屏」回到半屏。
   */
  panelFullscreen: boolean;
  /**
   * 移动端城市概览被用户主动收起（点 × 关闭）。
   * true 时城市面板隐藏，但地图仍停在当前下钻的城市视图、不飞回区域总览；
   * 由 ESC / 返回键 / 顶栏「总览」负责真正复位。重新进入任意城市会清掉它。
   */
  cityPanelDismissed: boolean;
  /** 地图地形图层（山地 / 湖泊 / 江河）是否显示，默认开 */
  terrain: boolean;
  /** 天气图层（地图空中的雨 / 雪 / 晴 / 阴等）是否显示，默认开 */
  weather: boolean;
  /** 「去过」标记的样式：旗子 / 图钉 / 打卡章 / 脚印 */
  visitedStyle: VisitedStyle;

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
  togglePanelFullscreen: (open?: boolean) => void;
  setCityPanelDismissed: (dismissed: boolean) => void;
  setTerrainOpen: (open?: boolean) => void;
  setWeatherOpen: (open?: boolean) => void;
  setVisitedStyle: (style: VisitedStyle) => void;
  openPhotoWall: (state: PhotoWallState) => void;
  closePhotoWall: () => void;
  showToast: (msg: string) => void;
}

/** 读取「去过」标记样式；存的是脏值（旧版本残留 / 手改）就退回默认旗子 */
function readMarkerStyle(): VisitedStyle {
  try {
    const raw = localStorage.getItem(MARKER_STYLE_KEY);
    return isVisitedStyle(raw) ? raw : 'flag';
  } catch {
    return 'flag';
  }
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

/**
 * 读取图层开关。读不到 / 读坏了一律回默认「都开」，
 * 不能因为一条脏数据就让地形或天气整块消失。
 */
function readLayers(): { terrain: boolean; weather: boolean } {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (!raw) return { terrain: true, weather: true };
    const p = JSON.parse(raw) as { terrain?: unknown; weather?: unknown };
    return {
      terrain: typeof p.terrain === 'boolean' ? p.terrain : true,
      weather: typeof p.weather === 'boolean' ? p.weather : true,
    };
  } catch {
    return { terrain: true, weather: true };
  }
}

function writeLayers(next: { terrain: boolean; weather: boolean }): void {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用就只在本次会话生效 */
  }
}

let toastTimer: number | null = null;

/** 图层开关只读一次盘，别在 state 初始化的两个字段里各解析一遍 */
const initialLayers = readLayers();

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
  panelFullscreen: false,
  cityPanelDismissed: false,
  terrain: initialLayers.terrain,
  weather: initialLayers.weather,
  visitedStyle: readMarkerStyle(),

  openDrawer: () => set({ drawerOpen: true, favoritesOpen: false }),
  // 关抽屉时顺手复位全屏态：否则抽屉里点过「全屏」再用 ESC / 返回关掉，
  // 城市面板会顶着同一个 panelFullscreen 直接铺满，把地图盖死。
  closeDrawer: () => set({ drawerOpen: false, leafCard: null, panelFullscreen: false }),

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
    const added = next[key].length > list.length;
    const label = kind === 'district' ? '区县' : kind === 'city' ? '城市' : '景点';
    // 落盘失败要如实提示：否则用户以为收藏成功，刷新后才发现丢了
    void staticRepository.saveFavorites(next).then((ok) => {
      get().showToast(
        ok
          ? added
            ? `已加入收藏 · ${label}`
            : '已取消收藏'
          : '收藏未能保存到本机（存储空间不足？）',
      );
    });
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

  togglePanelFullscreen: (open) =>
    set((s) => ({ panelFullscreen: open ?? !s.panelFullscreen })),

  setCityPanelDismissed: (dismissed) => set({ cityPanelDismissed: dismissed }),

  setTerrainOpen: (open) =>
    set((s) => {
      const terrain = open ?? !s.terrain;
      writeLayers({ terrain, weather: s.weather });
      return { terrain };
    }),

  setWeatherOpen: (open) =>
    set((s) => {
      const weather = open ?? !s.weather;
      writeLayers({ terrain: s.terrain, weather });
      return { weather };
    }),

  setVisitedStyle: (visitedStyle) => {
    set({ visitedStyle });
    try {
      localStorage.setItem(MARKER_STYLE_KEY, visitedStyle);
    } catch {
      /* 存储不可用就只在本次会话生效 */
    }
  },

  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 2400);
  },
}));
