import { create } from 'zustand';
import type { District, WeatherCache } from '../data/types';
import { staticRepository } from '../data/staticRepository';

export type WeatherStatus = 'idle' | 'loading' | 'online' | 'offline';

const TTL_MS = 3 * 60 * 60 * 1000; // 3 小时

interface WeatherState {
  cache: Record<string, WeatherCache>;
  status: Record<string, WeatherStatus>;
  ensure: (district: District) => Promise<void>;
}

export const useWeather = create<WeatherState>((set, get) => ({
  cache: {},
  status: {},

  ensure: async (district) => {
    const cached = get().cache[district.id] ?? (await staticRepository.getCachedWeather(district.id));
    const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS;
    if (cached) {
      set((s) => ({ cache: { ...s.cache, [district.id]: cached } }));
    }
    if (fresh) {
      set((s) => ({ status: { ...s.status, [district.id]: 'online' } }));
      return;
    }
    if (!district.center) {
      set((s) => ({ status: { ...s.status, [district.id]: cached ? 'offline' : 'idle' } }));
      return;
    }

    set((s) => ({ status: { ...s.status, [district.id]: 'loading' } }));
    try {
      const data = await staticRepository.fetchWeather(district.id, district.center[1], district.center[0]);
      set((s) => ({
        cache: { ...s.cache, [district.id]: data },
        status: { ...s.status, [district.id]: 'online' },
      }));
    } catch {
      set((s) => ({
        status: { ...s.status, [district.id]: cached ? 'offline' : 'offline' },
      }));
    }
  },
}));
