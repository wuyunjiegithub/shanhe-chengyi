/**
 * 地形数据（真实高程 + 真实湖岸线 + 真实河道）。
 *
 * 数据由 `scripts/build-terrain.mjs` 在构建期生成，落在 public/geo/terrain/，
 * 随安装包一起分发，运行时不做任何网络请求。
 *
 * 数据来源：
 * - 高程：AWS Terrain Tiles（Terrarium 编码 DEM，源数据 SRTM / ASTER / ETOPO）
 * - 水体 / 河道：© OpenStreetMap 贡献者（ODbL），经 Overpass API 导出
 *
 * 说明：这是用于「山川观感」的示意级地形，非测绘成果，不用于定位或量算。
 */

export interface TerrainMeta {
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  /** 网格内最高海拔（米），用于把 0-255 的量化值还原成米 */
  maxElev: number;
  note?: string;
}

export interface WaterBody {
  id: string;
  name: string;
  /** 面积（km²） */
  area: number;
  /** 真实岸线，[lng, lat] 序列（简化后） */
  ring: [number, number][];
}

export interface RiverLine {
  id: string;
  name: string;
  /** 长度（km） */
  km: number;
  /** 真实河道走向，[lng, lat] 序列（简化后） */
  line: [number, number][];
}

export interface TerrainData {
  meta: TerrainMeta;
  /** cols*rows，0-255 线性映射 [0, maxElev] */
  height: Uint8Array;
  /** cols*rows，1 = 江浙沪皖陆域内，0 = 海面 / 省外 */
  mask: Uint8Array;
  water: WaterBody[];
  rivers: RiverLine[];
}

let pending: Promise<TerrainData | null> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`加载失败 ${path}（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

async function getBinary(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`加载失败 ${path}（HTTP ${res.status}）`);
  return new Uint8Array(await res.arrayBuffer());
}

async function load(): Promise<TerrainData> {
  const [meta, height, mask, water, rivers] = await Promise.all([
    getJson<TerrainMeta>('/geo/terrain/height.json'),
    getBinary('/geo/terrain/height.bin'),
    getBinary('/geo/terrain/mask.bin'),
    getJson<WaterBody[]>('/geo/terrain/water.json'),
    getJson<RiverLine[]>('/geo/terrain/rivers.json'),
  ]);
  return { meta, height, mask, water, rivers };
}

/**
 * 加载地形数据（进程内只加载一次）。
 * 任何一步失败都返回 null —— 地形只是观感增强，缺了不该影响地图主功能。
 */
export function loadTerrainData(): Promise<TerrainData | null> {
  if (!pending) {
    pending = load().catch((e) => {
      console.warn('[terrain] 地形数据加载失败，已跳过地形图层：', e);
      return null;
    });
  }
  return pending;
}
