import type { Province, Tag } from '../../data/types';

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

export const PROVINCE_LABEL: Record<Province, string> = {
  上海市: '上海市',
  江苏省: '江苏省',
  浙江省: '浙江省',
  安徽省: '安徽省',
};

export const PROVINCE_VAR: Record<Province, string> = {
  上海市: 'var(--prov-sh)',
  江苏省: 'var(--prov-js)',
  浙江省: 'var(--prov-zj)',
  安徽省: 'var(--prov-ah)',
};

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
