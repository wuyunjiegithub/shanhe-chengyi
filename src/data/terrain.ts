/**
 * 地形要素（山地 · 湖泊 · 江河）的静态定义。
 *
 * 坐标用经纬度（与各区县/景点同一套地理基准），由场景端的 projectPoint
 * 投影到与板块完全一致的世界坐标系，保证地形精确落在对应的陆地/水系之上。
 *
 * 这是一份「写意」而非测绘级的数据：
 * - 湖泊用椭圆近似（中心 + 经纬度半轴），足够在地图上读出一片水域；
 * - 山脉用单点 + 风格化高度/半径，仅作「点睛」，不做整图 DEM 起伏；
 * - 江河用少量折线节点勾出走向，发光描边即可辨识。
 * 真要高精度可后续换成 Natural Earth / OSM 的江浙沪皖矢量再落位。
 */

/** 湖泊（含海，海暂未启用）：椭圆近似 */
export interface WaterDef {
  id: string;
  name: string;
  /** 椭圆中心经纬度（度） */
  lng: number;
  lat: number;
  /** 经度方向半轴（度） */
  rx: number;
  /** 纬度方向半轴（度） */
  ry: number;
}

/** 江河：折线（经纬度） */
export interface RiverDef {
  id: string;
  name: string;
  line: [number, number][];
}

/** 山脉：单峰（经纬度 + 风格化尺寸） */
export interface MountainDef {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** 风格化世界高度（省份板块约 2.6 高，山应明显高出） */
  height: number;
  /** 底半径（世界单位） */
  radius: number;
}

/** 五大湖：太湖 / 西湖 / 千岛湖 / 巢湖 / 洪泽湖 */
export const WATERS: WaterDef[] = [
  // 太湖：横跨苏浙，长三角最大的淡水湖
  { id: 'taihu', name: '太湖', lng: 120.15, lat: 31.1, rx: 0.52, ry: 0.38 },
  // 西湖：杭州城西，极小
  { id: 'xihu', name: '西湖', lng: 120.13, lat: 30.25, rx: 0.07, ry: 0.05 },
  // 千岛湖：新安江水库，淳安境内，西南—东北狭长
  { id: 'qiandao', name: '千岛湖', lng: 119.05, lat: 29.6, rx: 0.36, ry: 0.17 },
  // 巢湖：合肥南侧
  { id: 'chaohu', name: '巢湖', lng: 117.35, lat: 31.5, rx: 0.33, ry: 0.22 },
  // 洪泽湖：江苏北部
  { id: 'hongze', name: '洪泽湖', lng: 118.85, lat: 33.25, rx: 0.3, ry: 0.27 },
];

/** 三大水系：长江 / 钱塘江 / 京杭大运河（折线为写意走向） */
export const RIVERS: RiverDef[] = [
  {
    id: 'yangtze',
    name: '长江',
    // 从皖西入境，经安庆—芜湖—南京—镇江—南通，于上海北侧入海
    line: [
      [115.9, 30.0],
      [116.8, 31.0],
      [117.6, 31.5],
      [118.4, 32.0],
      [119.0, 32.1],
      [119.6, 32.05],
      [120.2, 31.9],
      [120.9, 31.7],
      [121.5, 31.5],
      [121.9, 31.45],
    ],
  },
  {
    id: 'qiantang',
    name: '钱塘江',
    // 自千岛湖向东北，经杭州入钱塘江口
    line: [
      [119.0, 29.6],
      [119.5, 29.75],
      [119.9, 29.95],
      [120.2, 30.15],
      [120.45, 30.3],
      [120.65, 30.42],
    ],
  },
  {
    id: 'grandcanal',
    name: '京杭大运河',
    // 浙北—苏南—苏中，近南北走向
    line: [
      [119.9, 30.6],
      [119.95, 31.2],
      [120.0, 31.8],
      [119.95, 32.4],
      [119.85, 33.0],
      [119.7, 33.4],
    ],
  },
];

/** 名山：黄山 / 莫干山 / 天目山 / 雁荡山 / 天台山 / 九华山 */
export const MOUNTAINS: MountainDef[] = [
  { id: 'huangshan', name: '黄山', lng: 118.17, lat: 30.13, height: 6.2, radius: 3.2 },
  { id: 'moganshan', name: '莫干山', lng: 119.83, lat: 30.56, height: 3.2, radius: 2.0 },
  { id: 'tianmushan', name: '天目山', lng: 119.43, lat: 30.35, height: 4.0, radius: 2.4 },
  { id: 'yandangshan', name: '雁荡山', lng: 121.07, lat: 28.37, height: 4.6, radius: 2.6 },
  { id: 'tiantaishan', name: '天台山', lng: 121.05, lat: 29.15, height: 4.0, radius: 2.4 },
  { id: 'jiuhuashan', name: '九华山', lng: 117.8, lat: 30.5, height: 5.0, radius: 3.0 },
];
