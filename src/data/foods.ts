import type { City, District, Food } from './types';

/**
 * 区县美食的生效列表。
 *
 * 全国 2840 个区县里只有 321 个单独录了美食，而 335 个已录入城市**全部**有城市级美食。
 * 与其让 2519 个区县显示「待录入」，不如回退到所属城市的美食 —— 这是真实存在的
 * 「当地美食」，只是粒度是市而不是区县，界面上会明确标注来源，不让用户误以为是区县专属。
 */
export interface EffectiveFoods {
  foods: Food[];
  /**
   * 美食来源：
   * - `'district'` 区县自己录入的
   * - `'city'`    区县没录，取自所属城市
   */
  source: 'district' | 'city';
  /** `source === 'city'` 时为城市名，用于界面标注「以下为 XX 市美食」 */
  cityName: string | null;
}

/**
 * 区县码 → 所属地级市码。与 `sandbox.cityIdOfDistrict` 同一套规则，
 * 这里复制一份是为了让数据层保持纯净（sandbox 依赖 stores，反向引用会成环）。
 *
 * - 区县码前 4 位即地级市：330127（淳安）→ 330100（杭州）
 * - 4 个直辖市（京 11 / 津 12 / 沪 31 / 渝 50）没有地级市这一层，
 *   区县码前 2 位即市本级：110101（东城）→ 110000（北京）
 */
export function cityIdOfDistrictId(districtId: string): string {
  const prefix = districtId.slice(0, 2);
  if (prefix === '11' || prefix === '12' || prefix === '31' || prefix === '50') {
    return prefix + '0000';
  }
  return districtId.slice(0, 4) + '00';
}

/**
 * 取一个区县「实际展示用」的美食列表。
 *
 * 回退只发生在区县完全没录美食时；区县录了哪怕一条，都以区县为准，
 * 不做「区县 + 城市」拼接 —— 拼接会让同一道菜在不同粒度重复出现，读起来像凑数。
 */
export function effectiveFoods(
  district: District | null | undefined,
  cities: City[],
): EffectiveFoods {
  const own = district?.foods ?? [];
  if (own.length > 0) {
    return { foods: own, source: 'district', cityName: null };
  }
  if (!district) return { foods: [], source: 'district', cityName: null };

  const cityId = cityIdOfDistrictId(district.id);
  const city = cities.find((c) => c.id === cityId) ?? cities.find((c) => c.districts.includes(district.id));
  if (!city?.foods?.length) {
    return { foods: [], source: 'district', cityName: null };
  }
  return { foods: city.foods, source: 'city', cityName: city.name };
}

/** 按名字在「生效美食」里找一条（详情卡用，必须与列表走同一套回退规则） */
export function findEffectiveFood(
  district: District | null | undefined,
  cities: City[],
  name: string,
): Food | null {
  const { foods } = effectiveFoods(district, cities);
  return foods.find((f) => f.name === name) ?? null;
}
