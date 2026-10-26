// 全国化：省份改为开放式 string（全国 34 个省级行政区，不再写死 4 省）
export type Province = string;

export type Tag =
  | '古镇'
  | '山水'
  | '博物馆'
  | '寺庙'
  | '亲子'
  | '拍照'
  | '徒步'
  | '历史文化';

export interface City {
  id: string;
  name: string;
  province: Province;
  districts: string[];
  intro?: string;
  featuredDistricts?: string[];
  indexed?: boolean;
  /** 城市级美食推荐（≥5，带图），与区县美食互补 */
  foods?: Food[];
  /** 代表这座城市的诗句 / 词章 / 名篇一句 */
  poem?: string;
  /** 诗句出处，如「《某某》· 作者」 */
  poemFrom?: string;
  /** 城区所在：核心市辖区的 id 与名称，用于在概览里说明「城区」构成 */
  urbanDistricts?: { id: string; name: string }[];
  /** 城区说明补充文案 */
  urbanNote?: string;
  /** 城市封面图（缺省按 /assets/cities/<id>/banner.jpg 推导） */
  banner?: string;
}

export interface PersonNote {
  name: string;
  note: string;
}

export interface Food {
  name: string;
  category: string;
  recommend: string;
  note: string;
  image?: string;
}

/** 区县特产 / 非物质文化遗产条目 */
export interface Specialty {
  name: string;
  kind: '特产' | '非遗';
  note: string;
}

export interface District {
  id: string;
  name: string;
  city: string;
  province: Province;
  center?: [number, number];
  oneLiner: string;
  tags: Tag[];
  history?: string;
  culture?: string;
  people?: PersonNote[];
  features?: string[];
  /** 本地特产与非物质文化遗产（与美食互补） */
  specialties?: Specialty[];
  foods?: Food[];
  spots: string[];
  cover?: string;
  image?: string;
  source?: string;
  updatedAt: string;
}

export interface Spot {
  id: string;
  name: string;
  districtId: string;
  lng: number;
  lat: number;
  summary: string;
  image?: string;
  tags: Tag[];
  hot?: boolean;
  suitableFor?: string[];
  duration?: string;
  source?: string;
  updatedAt: string;
}

export interface DailyWeather {
  date: string;
  code: number;
  tMax: number;
  tMin: number;
  precip: number;
  windKmh: number;
}

export interface CurrentWeather {
  /** 此刻观测到的 WMO 天气码（最近一次观测，通常 15 分钟内） */
  code: number;
  /** 此刻气温 ℃ */
  temp: number;
  /** 观测时刻（ISO，本地时区） */
  time: string;
}

export interface WeatherCache {
  districtId: string;
  fetchedAt: string;
  source: 'open-meteo';
  tz: string;
  /** 此刻真实观测（用于 3D 特效「现在下没下」的判定） */
  current?: CurrentWeather;
  /** 未来 7 天每日概况（用于天气面板的多日预报展示） */
  daily: DailyWeather[];
}

/** 3D 天气特效用的「大类」：晴 / 多云 / 阴 / 雨 / 雪 / 雾 */
export type WeatherKind = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'snow' | 'fog';

export interface Favorites {
  districts: string[];
  spots: string[];
  cities: string[];
}

export interface GeoGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface GeoFeature {
  id: string;
  name: string;
  province?: Province;
  indexed?: boolean;
  center?: [number, number] | null;
  geometry: GeoGeometry;
}

export interface ProjectedShape {
  id: string;
  name: string;
  province?: Province;
  indexed?: boolean;
  /** 主轮廓（面积最大的外环），用于基座与交互点 */
  outline: [number, number][];
  /** 全部外环（海岛 / 飞地分开的要素需要逐环建网格，否则只有最后一部分可交互） */
  outlines?: [number, number][][];
  /** 保证落在主轮廓内的点（面积质心，界外时退化为网格采样） */
  centroid: [number, number];
}