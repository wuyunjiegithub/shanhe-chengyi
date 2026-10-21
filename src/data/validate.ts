import type { District, Spot, Tag } from './types';

export const ALL_TAGS: Tag[] = ['古镇', '山水', '博物馆', '寺庙', '亲子', '拍照', '徒步', '历史文化'];

export interface Issue {
  level: 'error' | 'warn';
  /** 字段路径，如 oneLiner / spot.<id>.lng */
  field: string;
  message: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 中国陆地经纬度大致范围，用于拦截明显错误的坐标 */
const LNG_MIN = 73;
const LNG_MAX = 135.5;
const LAT_MIN = 3;
const LAT_MAX = 54;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function validateSpot(s: Spot): Issue[] {
  const issues: Issue[] = [];
  if (!s.name.trim()) issues.push({ level: 'error', field: 'name', message: '景点名称不能为空' });
  if (!s.summary.trim()) issues.push({ level: 'error', field: 'summary', message: '景点简介不能为空' });
  if (!isFiniteNumber(s.lng) || s.lng < LNG_MIN || s.lng > LNG_MAX) {
    issues.push({ level: 'error', field: 'lng', message: `经度应在 ${LNG_MIN}–${LNG_MAX} 之间` });
  }
  if (!isFiniteNumber(s.lat) || s.lat < LAT_MIN || s.lat > LAT_MAX) {
    issues.push({ level: 'error', field: 'lat', message: `纬度应在 ${LAT_MIN}–${LAT_MAX} 之间` });
  }
  if (!Array.isArray(s.tags) || s.tags.length === 0) {
    issues.push({ level: 'error', field: 'tags', message: '至少选择 1 个标签' });
  }
  if (s.tags.length > 4) {
    issues.push({ level: 'warn', field: 'tags', message: '标签建议不超过 4 个' });
  }
  if (!DATE_RE.test(s.updatedAt)) {
    issues.push({ level: 'error', field: 'updatedAt', message: '更新时间格式应为 YYYY-MM-DD' });
  }
  if (s.duration && s.duration.length > 12) {
    issues.push({ level: 'warn', field: 'duration', message: '建议游玩时长建议控制在 12 字内' });
  }
  return issues;
}

export function validateDistrict(
  d: District,
  spots: Spot[],
  knownSpotIds: Set<string>,
): Issue[] {
  const issues: Issue[] = [];
  if (!d.name.trim()) issues.push({ level: 'error', field: 'name', message: '区县名称不能为空' });
  if (!d.oneLiner.trim()) {
    issues.push({ level: 'error', field: 'oneLiner', message: '一句话推荐不能为空' });
  } else if (d.oneLiner.length > 60) {
    issues.push({ level: 'warn', field: 'oneLiner', message: '一句话推荐建议不超过 60 字' });
  }
  if (!Array.isArray(d.tags) || d.tags.length === 0) {
    issues.push({ level: 'error', field: 'tags', message: '至少选择 1 个标签' });
  } else if (d.tags.length > 4) {
    issues.push({ level: 'warn', field: 'tags', message: '标签建议不超过 4 个' });
  }
  if (!DATE_RE.test(d.updatedAt)) {
    issues.push({ level: 'error', field: 'updatedAt', message: '更新时间格式应为 YYYY-MM-DD' });
  }

  for (const id of d.spots) {
    if (!knownSpotIds.has(id)) {
      issues.push({ level: 'error', field: 'spots', message: `引用了不存在的景点 ${id}` });
    }
  }

  const spotIds = new Set<string>();
  for (const s of spots) {
    if (spotIds.has(s.id)) {
      issues.push({ level: 'error', field: 'spots', message: `景点 id 重复：${s.id}` });
    }
    spotIds.add(s.id);
  }

  (d.people ?? []).forEach((p, i) => {
    if (!p.name.trim()) {
      issues.push({ level: 'error', field: `people.${i}.name`, message: `第 ${i + 1} 位名人缺少姓名` });
    }
  });

  (d.foods ?? []).forEach((f, i) => {
    if (!f.name.trim()) {
      issues.push({ level: 'error', field: `foods.${i}.name`, message: `第 ${i + 1} 条美食缺少名称` });
    }
    if (!f.category.trim()) {
      issues.push({ level: 'warn', field: `foods.${i}.category`, message: `「${f.name || `美食 ${i + 1}`}」建议补充品类` });
    }
  });

  (d.specialties ?? []).forEach((s, i) => {
    if (!s.name.trim()) {
      issues.push({ level: 'error', field: `specialties.${i}.name`, message: `第 ${i + 1} 条特产/非遗缺少名称` });
    }
    if (s.kind !== '特产' && s.kind !== '非遗') {
      issues.push({ level: 'error', field: `specialties.${i}.kind`, message: `「${s.name}」类型只能是「特产」或「非遗」` });
    }
  });
  if ((d.specialties ?? []).length > 8) {
    issues.push({ level: 'warn', field: 'specialties', message: '特产/非遗建议不超过 8 条' });
  }

  return issues;
}

/** 编辑态一次性校验：区县 + 其下全部景点（景点字段加 spot.<id>. 前缀） */
export function validateDraft(d: District, spots: Spot[]): Issue[] {
  const known = new Set(spots.map((s) => s.id));
  const issues = validateDistrict(d, spots, known);
  for (const s of spots) {
    for (const issue of validateSpot(s)) {
      issues.push({ ...issue, field: `spot.${s.id}.${issue.field}` });
    }
  }
  return issues;
}

/** 判断两个筛选条件是否构成“内容为空” */
export function isEmptyContent(d: District): boolean {
  return !d.oneLiner.trim() && (!d.history || !d.history.trim()) && (d.spots?.length ?? 0) === 0;
}
