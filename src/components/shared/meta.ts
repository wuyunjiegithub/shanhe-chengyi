import type { Tag, WeatherCache, WeatherKind } from '../../data/types';

export const TAGS: Tag[] = ['古镇', '山水', '博物馆', '寺庙', '亲子', '拍照', '徒步', '历史文化'];

export const TAG_COLOR: Record<Tag, string> = {
  古镇: '#c084fc',
  山水: '#38bdf8',
  博物馆: '#f5a623',
  寺庙: '#e2c044',
  亲子: '#3bb273',
  拍照: '#f472b6',
  徒步: '#22d3ee',
  历史文化: '#e3605f',
};

export const TAG_STYLE: Record<Tag, { color: string; bg: string; border: string }> = Object.fromEntries(
  TAGS.map((t) => [
    t,
    {
      color: TAG_COLOR[t],
      bg: `color-mix(in srgb, ${TAG_COLOR[t]} 14%, transparent)`,
      border: `color-mix(in srgb, ${TAG_COLOR[t]} 38%, transparent)`,
    },
  ]),
) as Record<Tag, { color: string; bg: string; border: string }>;

/**
 * 省份配色：全国化后不再写死 4 省，改为「省份名 → 稳定色相」动态推导，
 * 保证 34 个省级行政区各有可区分的颜色，且不依赖 34 个 CSS 变量。
 */
export function provHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function provColor(name: string): string {
  return `hsl(${provHue(name)} 68% 62%)`;
}
export function provBg(name: string): string {
  return `hsl(${provHue(name)} 68% 62% / 0.16)`;
}

/** 全国省份顺序（左索引分组用），按地理/惯例排序；未在表内的省份排到末尾 */
export const NATIONAL_PROVINCE_ORDER: string[] = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
  '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省',
  '重庆市', '四川省', '贵州省', '云南省', '西藏自治区',
  '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区',
  '台湾省', '香港特别行政区', '澳门特别行政区',
];

const WEATHER_MAP: Record<number, { label: string; icon: string }> = {
  0: { label: '晴', icon: '☀' },
  1: { label: '晴间多云', icon: '🌤' },
  2: { label: '多云', icon: '⛅' },
  3: { label: '阴', icon: '☁' },
  45: { label: '雾', icon: '🌫' },
  48: { label: '雾凇', icon: '🌫' },
  51: { label: '毛毛雨', icon: '🌦' },
  53: { label: '毛毛雨', icon: '🌦' },
  55: { label: '毛毛雨', icon: '🌦' },
  56: { label: '冻雨', icon: '🌧' },
  57: { label: '冻雨', icon: '🌧' },
  61: { label: '小雨', icon: '🌦' },
  63: { label: '中雨', icon: '🌧' },
  65: { label: '大雨', icon: '🌧' },
  66: { label: '冻雨', icon: '🌧' },
  67: { label: '冻雨', icon: '🌧' },
  71: { label: '小雪', icon: '🌨' },
  73: { label: '中雪', icon: '🌨' },
  75: { label: '大雪', icon: '❄' },
  77: { label: '雪粒', icon: '🌨' },
  80: { label: '阵雨', icon: '🌦' },
  81: { label: '阵雨', icon: '🌧' },
  82: { label: '强阵雨', icon: '⛈' },
  85: { label: '阵雪', icon: '🌨' },
  86: { label: '阵雪', icon: '❄' },
  95: { label: '雷阵雨', icon: '⛈' },
  96: { label: '雷暴冰雹', icon: '⛈' },
  99: { label: '雷暴冰雹', icon: '⛈' },
};

export function weatherOf(code: number): { label: string; icon: string } {
  return WEATHER_MAP[code] ?? { label: '未知', icon: '·' };
}

/** 把 WMO 天气代码归并成 3D 天气特效用的「大类」 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return 'sunny';
  if (code === 1 || code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return 'rain';
  // 未知 / 异常码：按多云处理，绝不落到降水——
  // 否则一个没覆盖到的码就会让整张地图莫名其妙下起雨来。
  return 'cloudy';
}

/** 取今天（daily[0]）的天气大类；无缓存时返回 null（用于多日预报展示） */
export function todayWeatherKind(cache: WeatherCache | undefined): WeatherKind | null {
  if (!cache || !cache.daily || cache.daily.length === 0) return null;
  return weatherKind(cache.daily[0].code);
}

/**
 * 取「此刻」天气大类：优先用 open-meteo 的 current 实时观测码，
 * 没有时回退到 daily[0]（今日概况）。3D 特效用它来判定「现在下没下」，
 * 避免「当天某时段下过雪就被判一整天在下雪」的误报。
 */
export function liveWeatherKind(cache: WeatherCache | undefined): WeatherKind | null {
  if (!cache) return null;
  if (cache.current) return weatherKind(cache.current.code);
  if (cache.daily && cache.daily.length > 0) return weatherKind(cache.daily[0].code);
  return null;
}

/** 由主标签生成缩略图底色（离线，不依赖外链图片） */
export function thumbColor(tags: Tag[] | undefined): string {
  const base = tags?.[0] ?? '历史文化';
  return mixHex(TAG_COLOR[base], '#0e131f', 0.24);
}

function mixHex(fg: string, bg: string, alpha: number): string {
  const parse = (hex: string) => {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(fg);
  const [r2, g2, b2] = parse(bg);
  const to = (c1: number, c2: number) => Math.round(c1 * alpha + c2 * (1 - alpha));
  return `rgb(${to(r1, r2)}, ${to(g1, g2)}, ${to(b1, b2)})`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return WEEKDAYS[d.getDay()] ?? '';
}

export function monthDayOf(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
