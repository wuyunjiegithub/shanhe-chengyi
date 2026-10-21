import { create } from 'zustand';
import type { City } from '../data/types';

export type Level = 'region' | 'city';

interface NavigationState {
  level: Level;
  currentCity: City | null;
  activeDistrictId: string | null;
  /** 搜索/收藏定位到的景点，用于 pin 高亮 */
  focusSpotId: string | null;
  hovered: { id: string; name: string; province?: string; kind?: string } | null;
  /** 有收藏区县的城市（区域总览上的橙色触点） */
  visitedCities: string[];

  enterCity: (city: City) => void;
  backToRegion: () => void;
  selectDistrict: (id: string | null) => void;
  focusSpot: (id: string | null) => void;
  setHovered: (h: NavigationState['hovered']) => void;
  setVisitedCities: (ids: string[]) => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  level: 'region',
  currentCity: null,
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

  backToRegion: () =>
    set({
      level: 'region',
      currentCity: null,
      activeDistrictId: null,
      focusSpotId: null,
      hovered: null,
    }),

  selectDistrict: (id) => set({ activeDistrictId: id, focusSpotId: null }),
  focusSpot: (id) => set({ focusSpotId: id }),
  setHovered: (hovered) => set({ hovered }),
  setVisitedCities: (visitedCities) => set({ visitedCities }),
}));
