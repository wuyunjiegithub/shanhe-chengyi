import { create } from 'zustand';
import type { City, District, GeoFeature, Spot } from '../data/types';
import { staticRepository } from '../data/staticRepository';
import { editedDistrictIds } from '../data/contentEdits';

interface DataState {
  cities: City[];
  districts: Record<string, District>;
  spotsByDistrict: Record<string, Spot[]>;
  spots: Record<string, Spot>;
  cityGeo: GeoFeature[];
  /** 区县 id → 名称（含未录入区县，来自 GeoJSON） */
  districtNames: Record<string, string>;
  /** 被本地编辑过的区县 id，用于入口角标与列表标记 */
  editedDistrictIds: string[];
  loaded: boolean;
  error: string | null;

  loadCore: () => Promise<void>;
  reloadCore: () => Promise<void>;
  registerDistrictNames: (geo: GeoFeature[]) => void;

  /** 原子保存一个区县的区县内容与景点列表（含新增 / 删除） */
  applyDistrictEdits: (district: District, spots: Spot[]) => Promise<void>;
  /** 移除某个区县的全部本地内容（板块仍由 GeoJSON 呈现，回到「未录入」） */
  removeDistrictContent: (id: string) => Promise<void>;
  /** 导入内容 bundle（区县 + 景点），按当前数据集中已知 id 校验 */
  importContent: (
    districts: District[],
    spots: Spot[],
  ) => Promise<{ districts: number; spots: number; skipped: number }>;
  /** 清空全部本地编辑，回到静态内容 */
  resetContent: () => Promise<void>;
}

export const useData = create<DataState>((set, get) => ({
  cities: [],
  districts: {},
  spotsByDistrict: {},
  spots: {},
  cityGeo: [],
  districtNames: {},
  editedDistrictIds: [],
  loaded: false,
  error: null,

  registerDistrictNames: (geo) =>
    set((s) => {
      const districtNames = { ...s.districtNames };
      for (const f of geo) districtNames[f.id] = f.name;
      return { districtNames };
    }),

  loadCore: async () => {
    if (get().loaded) return;
    try {
      const [cities, districts, spots, cityGeo] = await Promise.all([
        staticRepository.listCities(),
        staticRepository.listAllDistricts(),
        staticRepository.listAllSpots(),
        staticRepository.listCityGeo(),
      ]);
      const districtMap: Record<string, District> = {};
      for (const d of districts) districtMap[d.id] = d;

      const byDistrict: Record<string, Spot[]> = {};
      const spotMap: Record<string, Spot> = {};
      for (const s of spots) {
        (byDistrict[s.districtId] ??= []).push(s);
        spotMap[s.id] = s;
      }

      set({
        cities,
        districts: districtMap,
        spotsByDistrict: byDistrict,
        spots: spotMap,
        cityGeo,
        editedDistrictIds: editedDistrictIds(),
        loaded: true,
        error: null,
      });
    } catch (err) {
      console.error(err);
      set({ error: err instanceof Error ? err.message : '数据加载失败' });
    }
  },

  reloadCore: async () => {
    set({ loaded: false });
    await get().loadCore();
  },

  applyDistrictEdits: async (district, spots) => {
    const normalized: District = { ...district, spots: spots.map((s) => s.id) };
    const prev = get().districts[district.id];
    const prevSpotIds = new Set(prev?.spots ?? []);
    const nextSpotIds = new Set(normalized.spots);

    for (const id of prevSpotIds) {
      if (!nextSpotIds.has(id)) await staticRepository.deleteSpotContent(id);
    }
    for (const spot of spots) await staticRepository.saveSpotContent(spot);
    await staticRepository.saveDistrictContent(normalized);

    set((state) => {
      const spotMap = { ...state.spots };
      for (const id of prevSpotIds) {
        if (!nextSpotIds.has(id)) delete spotMap[id];
      }
      for (const spot of spots) spotMap[spot.id] = spot;

      const edited = state.editedDistrictIds.includes(district.id)
        ? state.editedDistrictIds
        : [...state.editedDistrictIds, district.id];

      return {
        districts: { ...state.districts, [district.id]: normalized },
        spots: spotMap,
        spotsByDistrict: { ...state.spotsByDistrict, [district.id]: spots },
        editedDistrictIds: edited,
      };
    });
  },

  removeDistrictContent: async (id) => {
    const prev = get().districts[id];
    if (!prev) return;
    for (const spotId of prev.spots) await staticRepository.deleteSpotContent(spotId);
    await staticRepository.deleteDistrictContent(id);

    set((state) => {
      const districts = { ...state.districts };
      delete districts[id];
      const spots = { ...state.spots };
      for (const spotId of prev.spots) delete spots[spotId];
      const spotsByDistrict = { ...state.spotsByDistrict };
      delete spotsByDistrict[id];
      return {
        districts,
        spots,
        spotsByDistrict,
        editedDistrictIds: state.editedDistrictIds.filter((x) => x !== id),
      };
    });
  },

  importContent: async (districts, spots) => {
    const state = get();
    const knownDistrictIds = new Set(state.cities.flatMap((c) => c.districts));
    const knownSpotIds = new Set(Object.keys(state.spots));

    const validDistricts = districts.filter(
      (d) => d && typeof d.id === 'string' && knownDistrictIds.has(d.id),
    );
    const validSpots = spots.filter(
      (s) => s && typeof s.id === 'string' && knownDistrictIds.has(s.districtId),
    );
    const skipped = districts.length - validDistricts.length + (spots.length - validSpots.length);
    const importedSpotIds = new Set(validSpots.map((s) => s.id));

    for (const d of validDistricts) {
      const ids = (d.spots ?? []).filter((id) => importedSpotIds.has(id) || knownSpotIds.has(id));
      await staticRepository.saveDistrictContent({ ...d, spots: ids });
    }
    for (const s of validSpots) await staticRepository.saveSpotContent(s);

    // 只有景点、没有区县对象的 bundle：把新景点挂到现有区县的 spots 列表
    const importedByDistrict = new Map<string, string[]>();
    for (const s of validSpots) {
      if (validDistricts.some((d) => d.id === s.districtId)) continue;
      const list = importedByDistrict.get(s.districtId);
      if (list) list.push(s.id);
      else importedByDistrict.set(s.districtId, [s.id]);
    }
    for (const [districtId, ids] of importedByDistrict) {
      const current = state.districts[districtId];
      if (!current) continue;
      const merged = [...new Set([...current.spots, ...ids])];
      await staticRepository.saveDistrictContent({ ...current, spots: merged });
    }

    set({ loaded: false });
    await get().loadCore();
    return { districts: validDistricts.length, spots: validSpots.length, skipped };
  },

  resetContent: async () => {
    await staticRepository.resetContentEdits();
    set({ loaded: false, editedDistrictIds: [] });
    await get().loadCore();
  },
}));
