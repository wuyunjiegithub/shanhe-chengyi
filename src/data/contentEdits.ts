import type { City, District, Spot } from './types';

// 城市级编辑走与区县完全相同的覆盖层：编辑结果落 localStorage，读取时合并。

/**
 * 本地内容覆盖层：编辑结果落在 localStorage，与静态 JSON 解耦。
 * - 读取时由 applyEdits 合并：覆盖项优先，删除项剔除；
 * - 导出时把合并后的结果写成 bundle，可回写到 public/content；
 * - 接 Tauri 时把本模块的读写换成 repository 实现即可，UI 不用改。
 */
export interface ContentEdits {
  districts: Record<string, District>;
  spots: Record<string, Spot>;
  /** 城市级覆盖：整条 City 替换（保存时带全量字段，含 districts 列表，避免丢引用） */
  cities: Record<string, City>;
  deletedDistricts: string[];
  deletedSpots: string[];
  updatedAt: string;
}

export interface ContentBundle {
  cities: City[];
  districts: District[];
  spots: Spot[];
}

const STORAGE_KEY = 'ds.contentEdits.v1';

export function emptyEdits(): ContentEdits {
  return { districts: {}, spots: {}, cities: {}, deletedDistricts: [], deletedSpots: [], updatedAt: '' };
}

export function readEdits(): ContentEdits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyEdits();
    const parsed = JSON.parse(raw) as Partial<ContentEdits>;
    return {
      districts: parsed.districts && typeof parsed.districts === 'object' ? parsed.districts : {},
      spots: parsed.spots && typeof parsed.spots === 'object' ? parsed.spots : {},
      cities: parsed.cities && typeof parsed.cities === 'object' ? parsed.cities : {},
      deletedDistricts: Array.isArray(parsed.deletedDistricts) ? parsed.deletedDistricts : [],
      deletedSpots: Array.isArray(parsed.deletedSpots) ? parsed.deletedSpots : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return emptyEdits();
  }
}

export function writeEdits(next: ContentEdits): void {
  next.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearStoredEdits(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredEdits(): boolean {
  const e = readEdits();
  return (
    Object.keys(e.districts).length > 0 ||
    Object.keys(e.spots).length > 0 ||
    e.deletedDistricts.length > 0 ||
    e.deletedSpots.length > 0
  );
}

/** 已编辑的区县 id（用于顶部入口上的角标） */
export function editedDistrictIds(): string[] {
  const e = readEdits();
  const deleted = new Set(e.deletedDistricts);
  return Object.keys(e.districts).filter((id) => !deleted.has(id));
}

/** 已编辑的城市 id */
export function editedCityIds(): string[] {
  return Object.keys(readEdits().cities);
}

/**
 * 合并静态内容与本地覆盖：
 * - 区县 / 景点：覆盖项整条替换；
 * - 删除项被剔除，并同步清理区县 spots 与城市 districts 的引用；
 * - 返回全新对象，不修改入参。
 */
export function applyEdits(bundle: ContentBundle): ContentBundle {
  const edits = readEdits();
  const deletedDistricts = new Set(edits.deletedDistricts);
  const deletedSpots = new Set(edits.deletedSpots);

  const districtMap = new Map<string, District>();
  for (const d of bundle.districts) {
    if (!deletedDistricts.has(d.id)) districtMap.set(d.id, d);
  }
  for (const [id, d] of Object.entries(edits.districts)) {
    if (!deletedDistricts.has(id)) districtMap.set(id, d);
  }

  const spotMap = new Map<string, Spot>();
  for (const s of bundle.spots) {
    if (!deletedSpots.has(s.id)) spotMap.set(s.id, s);
  }
  for (const [id, s] of Object.entries(edits.spots)) {
    if (!deletedSpots.has(id)) spotMap.set(id, s);
  }

  const districts = [...districtMap.values()].map((d) => ({
    ...d,
    spots: d.spots.filter((id) => spotMap.has(id)),
  }));

  const cityMap = new Map<string, City>();
  for (const c of bundle.cities) {
    cityMap.set(c.id, { ...c, districts: c.districts.filter((id) => districtMap.has(id)) });
  }
  for (const [id, c] of Object.entries(edits.cities)) {
    cityMap.set(id, c);
  }

  const cities = [...cityMap.values()];

  return { cities, districts, spots: [...spotMap.values()] };
}
