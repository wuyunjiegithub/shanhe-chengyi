import { create } from 'zustand';
import type { District, WeatherCache } from '../data/types';
import { staticRepository } from '../data/staticRepository';

export type WeatherStatus = 'idle' | 'loading' | 'online' | 'offline';

const TTL_MS = 3 * 60 * 60 * 1000; // 多日预报：3 小时
/**
 * 「此刻」实况（current）的有效期要短得多：
 * 预报一天内不会变，但「现在下没下雨」半小时就可能翻篇。
 * 缓存里带 current 的按 30 分钟重拉，避免早上拉的一场雨挂到晚上还在下。
 */
const LIVE_TTL_MS = 30 * 60 * 1000;

interface WeatherState {
  cache: Record<string, WeatherCache>;
  status: Record<string, WeatherStatus>;
  ensure: (district: District) => Promise<void>;
  /** 按任意 key + 经纬度拉取天气（城市概览用：城市没有 District 实体） */
  ensureAt: (id: string, lat: number, lng: number) => Promise<void>;
  /** 强制刷新（忽略 3h 缓存 TTL），供每小时定时更新当前可见层 */
  refreshAt: (id: string, lat: number, lng: number) => Promise<void>;
}

export const useWeather = create<WeatherState>((set, get) => ({
  cache: {},
  status: {},

  ensure: async (district) => {
    if (!district.center) {
      set((s) => ({ status: { ...s.status, [district.id]: 'idle' } }));
      return;
    }
    await get().ensureAt(district.id, district.center[1], district.center[0]);
  },

  ensureAt: async (id, lat, lng) => {
    const cached = get().cache[id] ?? (await staticRepository.getCachedWeather(id));
    const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
    const fresh = cached != null && age < (cached.current ? LIVE_TTL_MS : TTL_MS);
    if (cached) {
      set((s) => ({ cache: { ...s.cache, [id]: cached } }));
    }
    if (fresh) {
      set((s) => ({ status: { ...s.status, [id]: 'online' } }));
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      set((s) => ({ status: { ...s.status, [id]: cached ? 'offline' : 'idle' } }));
      return;
    }

    set((s) => ({ status: { ...s.status, [id]: 'loading' } }));
    try {
      const data = await staticRepository.fetchWeather(id, lat, lng);
      set((s) => ({
        cache: { ...s.cache, [id]: data },
        status: { ...s.status, [id]: 'online' },
      }));
    } catch {
      set((s) => ({
        status: { ...s.status, [id]: cached ? 'offline' : 'offline' },
      }));
    }
  },

  refreshAt: async (id, lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    set((s) => ({ status: { ...s.status, [id]: 'loading' } }));
    try {
      const data = await staticRepository.fetchWeather(id, lat, lng);
      set((s) => ({
        cache: { ...s.cache, [id]: data },
        status: { ...s.status, [id]: 'online' },
      }));
    } catch {
      set((s) => ({ status: { ...s.status, [id]: s.cache[id] ? 'offline' : 'offline' } }));
    }
  },
}));
