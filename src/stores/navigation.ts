import { create } from 'zustand';
import type { City } from '../data/types';

export type Level = 'region' | 'city';

/**
 * 区域级（level === 'region'）时相机落在哪一层。
 *
 * 有了它，回退才凑得齐「区县 → 大市 → 省 → 全国」四级：
 * - 区县：ESC 取消选中 → 大市（本来就有）
 * - 大市：ESC → 省（本来就有）
 * - 省：ESC → 全国（**这一级原本缺失**，现在靠 regionScope 判断当前在省还是已在全国）
 */
export type RegionScope = 'home' | 'province' | 'nation';

interface NavigationState {
  level: Level;
  currentCity: City | null;
  /** 区域级当前取景范围：江浙沪老家 / 某个省 / 全国 */
  regionScope: RegionScope;
  activeDistrictId: string | null;
  /** 搜索/收藏定位到的景点，用于 pin 高亮 */
  focusSpotId: string | null;
  hovered: { id: string; name: string; province?: string; kind?: string } | null;
  /** 有收藏区县的城市（区域总览上的橙色触点） */
  visitedCities: string[];

  enterCity: (city: City) => void;
  backToRegion: (scope?: RegionScope) => void;
  selectDistrict: (id: string | null) => void;
  focusSpot: (id: string | null) => void;
  setHovered: (h: NavigationState['hovered']) => void;
  setVisitedCities: (ids: string[]) => void;
  /** 只改区域级取景范围（相机自己飞了、层级没变时用） */
  setRegionScope: (scope: RegionScope) => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  level: 'region',
  currentCity: null,
  regionScope: 'home',
  activeDistrictId: null,
  focusSpotId: null,
  hovered: null,
  visitedCities: [],

  enterCity: (city) =>
    set({
      level: 'city',
      currentCity: city,
      activeDistrictId: null,
      focusSpotId: null,
      hovered: null,
    }),

  backToRegion: (scope = 'home') =>
    set({
      level: 'region',
      currentCity: null,
      regionScope: scope,
      activeDistrictId: null,
      focusSpotId: null,
      hovered: null,
    }),

  selectDistrict: (id) => set({ activeDistrictId: id, focusSpotId: null }),
  focusSpot: (id) => set({ focusSpotId: id }),
  setHovered: (hovered) => set({ hovered }),
  setVisitedCities: (visitedCities) => set({ visitedCities }),
  setRegionScope: (regionScope) => set({ regionScope }),
}));
