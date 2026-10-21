import type { SandboxRepository } from './repository';
import { applyEdits, clearStoredEdits, readEdits, writeEdits } from './contentEdits';
import type { ContentBundle, ContentEdits } from './contentEdits';
import type { City, District, Favorites, GeoFeature, GeoGeometry, Province, Spot, WeatherCache } from './types';

const FAV_KEY = 'ds.favorites.v1';
const WEATHER_KEY = (id: string) => `ds.weather.v1.${id}`;

interface RawFeature {
  properties: {
    id?: string | number;
    adcode?: string | number;
    name: string;
    province?: string;
    indexed?: boolean;
    center?: [number, number];
    centroid?: [number, number];
  };
  geometry: GeoGeometry;
}

interface ContentBundleRaw {
  cities: City[];
  districts: District[];
  spots: Spot[];
}

let contentPromise: Promise<ContentBundle> | null = null;

async function loadJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`加载失败 ${path}（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

function loadContent(): Promise<ContentBundle> {
  if (!contentPromise) {
    contentPromise = Promise.all([
      loadJson<City[]>('/content/cities.json'),
      loadJson<District[]>('/content/districts.json'),
      loadJson<Spot[]>('/content/spots.json'),
    ]).then(([cities, districts, spots]): ContentBundleRaw => ({ cities, districts, spots }))
      .then((raw) => applyEdits(raw));
  }
  return contentPromise;
}

/** 写入本地编辑后让内容缓存失效，下次读取会重新合并 */
function invalidateContent(): void {
  contentPromise = null;
}

function mutateEdits(mutator: (edits: ContentEdits) => void): void {
  const edits = readEdits();
  mutator(edits);
  writeEdits(edits);
  invalidateContent();
}

function toGeoFeature(f: RawFeature, indexed: boolean): GeoFeature {
  return {
    id: String(f.properties.id ?? f.properties.adcode),
    name: f.properties.name,
    province: f.properties.province as Province | undefined,
    indexed,
    center: f.properties.centroid ?? f.properties.center ?? null,
    geometry: f.geometry,
  };
}

/**
 * 浏览器实现：读取 public/ 下的静态内容与地理数据。
 * 收藏、天气缓存落在 localStorage；后续接 Tauri 时同一接口换实现即可。
 */
export const staticRepository: SandboxRepository = {
  async listCities(): Promise<City[]> {
    return (await loadContent()).cities;
  },

  async listDistricts(cityId: string): Promise<District[]> {
    const { districts } = await loadContent();
    return districts.filter((d) => cityIdOf(d) === cityId);
  },

  async listAllDistricts(): Promise<District[]> {
    return (await loadContent()).districts;
  },

  async getDistrict(id: string): Promise<District | null> {
    const { districts } = await loadContent();
    return districts.find((d) => d.id === id) ?? null;
  },

  async listSpots(districtId: string): Promise<Spot[]> {
    const { spots } = await loadContent();
    return spots.filter((s) => s.districtId === districtId);
  },

  async listAllSpots(): Promise<Spot[]> {
    return (await loadContent()).spots;
  },

  async listCityGeo(): Promise<GeoFeature[]> {
    const [fc, { cities }] = await Promise.all([
      loadJson<{ features: RawFeature[] }>('/geo/cities.geojson'),
      loadContent(),
    ]);
    const indexed = new Set(cities.filter((c) => c.indexed).map((c) => c.id));
    return (fc.features ?? []).map((f) => toGeoFeature(f, indexed.has(String(f.properties.id ?? f.properties.adcode))));
  },

  async listDistrictGeo(cityId: string): Promise<GeoFeature[]> {
    const [fc, { districts }] = await Promise.all([
      loadJson<{ features: RawFeature[] }>(`/geo/districts/${cityId}.geojson`),
      loadContent(),
    ]);
    const indexed = new Set(districts.map((d) => d.id));
    return (fc.features ?? []).map((f) => toGeoFeature(f, indexed.has(String(f.properties.id ?? f.properties.adcode))));
  },

  async loadFavorites(): Promise<Favorites> {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Favorites>;
        return {
          districts: Array.isArray(parsed.districts) ? parsed.districts : [],
          spots: Array.isArray(parsed.spots) ? parsed.spots : [],
          cities: Array.isArray(parsed.cities) ? parsed.cities : [],
        };
      }
    } catch {
      /* 忽略损坏缓存 */
    }
    return { districts: [], spots: [], cities: [] };
  },

  /**
   * 返回是否落盘成功。localStorage 会因配额不足抛异常（其余 write 都做了 try/catch，
   * 唯独这里没有），静默吞掉的话用户会看到「已收藏」但刷新后收藏消失。
   */
  async saveFavorites(f: Favorites): Promise<boolean> {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(f));
      return true;
    } catch {
      return false;
    }
  },

  async fetchWeather(districtId: string, lat: number, lng: number): Promise<WeatherCache> {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
      timezone: 'Asia/Shanghai',
      forecast_days: '7',
    });
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`天气请求失败（HTTP ${res.status}）`);
      const raw = (await res.json()) as {
        daily?: {
          time?: string[];
          weather_code?: number[];
          temperature_2m_max?: number[];
          temperature_2m_min?: number[];
          precipitation_probability_max?: number[];
          wind_speed_10m_max?: number[];
        };
      };
      const d = raw.daily;
      if (!d?.time?.length) throw new Error('天气数据为空');
      const cache: WeatherCache = {
        districtId,
        fetchedAt: new Date().toISOString(),
        source: 'open-meteo',
        tz: 'Asia/Shanghai',
        daily: d.time.map((date, i) => ({
          date,
          code: d.weather_code?.[i] ?? 0,
          tMax: Math.round(d.temperature_2m_max?.[i] ?? 0),
          tMin: Math.round(d.temperature_2m_min?.[i] ?? 0),
          precip: Math.round(d.precipitation_probability_max?.[i] ?? 0),
          windKmh: Math.round(d.wind_speed_10m_max?.[i] ?? 0),
        })),
      };
      localStorage.setItem(WEATHER_KEY(districtId), JSON.stringify(cache));
      return cache;
    } finally {
      window.clearTimeout(timer);
    }
  },

  async getCachedWeather(districtId: string): Promise<WeatherCache | null> {
    try {
      const raw = localStorage.getItem(WEATHER_KEY(districtId));
      return raw ? (JSON.parse(raw) as WeatherCache) : null;
    } catch {
      return null;
    }
  },

  // ---- 本地内容编辑（P1：数据管理） ----

  async readContentEdits(): Promise<ContentEdits> {
    return readEdits();
  },

  async saveDistrictContent(d: District): Promise<void> {
    mutateEdits((edits) => {
      edits.districts[d.id] = d;
      edits.deletedDistricts = edits.deletedDistricts.filter((id) => id !== d.id);
    });
  },

  async saveSpotContent(s: Spot): Promise<void> {
    mutateEdits((edits) => {
      edits.spots[s.id] = s;
      edits.deletedSpots = edits.deletedSpots.filter((id) => id !== s.id);
    });
  },

  async deleteDistrictContent(id: string): Promise<void> {
    mutateEdits((edits) => {
      delete edits.districts[id];
      if (!edits.deletedDistricts.includes(id)) edits.deletedDistricts.push(id);
    });
  },

  async deleteSpotContent(id: string): Promise<void> {
    mutateEdits((edits) => {
      delete edits.spots[id];
      if (!edits.deletedSpots.includes(id)) edits.deletedSpots.push(id);
    });
  },

  async resetContentEdits(): Promise<void> {
    clearStoredEdits();
    invalidateContent();
  },
};

/** 区县 adcode 反查所属城市：直辖市取省级代码，其余取前 4 位 + 00 */
function cityIdOf(d: District): string {
  if (d.province === '上海市') return '310000';
  return d.id.slice(0, 4) + '00';
}
