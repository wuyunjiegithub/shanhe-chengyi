import type { ContentEdits } from './contentEdits';
import type { City, District, Favorites, GeoFeature, Spot, WeatherCache } from './types';

/**
 * 数据访问抽象：UI / store / scene 只依赖此接口，不感知存储实现。
 * - 当前实现：staticRepository（浏览器，读取 public/content 与 public/geo 静态文件）
 * - 后续实现：tauriRepository（invoke Rust command，读取 src-tauri/data 本地 JSON）
 */
export interface SandboxRepository {
  listCities(): Promise<City[]>;
  listDistricts(cityId: string): Promise<District[]>;
  listAllDistricts(): Promise<District[]>;
  getDistrict(id: string): Promise<District | null>;
  listSpots(districtId: string): Promise<Spot[]>;
  listAllSpots(): Promise<Spot[]>;

  listCityGeo(): Promise<GeoFeature[]>;
  listDistrictGeo(cityId: string): Promise<GeoFeature[]>;

  loadFavorites(): Promise<Favorites>;
  /** 返回是否落盘成功：localStorage 可能因配额不足抛错，调用方需要如实提示 */
  saveFavorites(f: Favorites): Promise<boolean>;

  fetchWeather(districtId: string, lat: number, lng: number): Promise<WeatherCache>;
  getCachedWeather(districtId: string): Promise<WeatherCache | null>;

  // ---- 本地内容编辑（P1：数据管理） ----
  readContentEdits(): Promise<ContentEdits>;
  saveDistrictContent(d: District): Promise<void>;
  saveCityContent(c: City): Promise<void>;
  saveSpotContent(s: Spot): Promise<void>;
  deleteDistrictContent(id: string): Promise<void>;
  deleteSpotContent(id: string): Promise<void>;
  resetContentEdits(): Promise<void>;
}
