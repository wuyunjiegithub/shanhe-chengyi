import { SceneManager } from '../scene/SceneManager';
import type { PinInput } from '../scene/pins';
import { computeProjection, projectFeatures, projectPoint } from '../data/projection';
import type { Projection } from '../data/projection';
import { staticRepository } from '../data/staticRepository';
import type { City, District, GeoFeature, Spot } from '../data/types';
import { useData } from '../stores/data';
import { useNavigation } from '../stores/navigation';
import { useUi } from '../stores/ui';
import { useWeather } from '../stores/weather';
import { useCityStatus } from '../stores/cityStatus';
import { usePhotoLib } from '../stores/photoLib';

let manager: SceneManager | null = null;
/** 各 store 的订阅句柄，teardownSandbox 时统一解绑（否则重复 initSandbox 会叠加订阅） */
const unsubscribers: Array<() => void> = [];
let projection: Projection | null = null;
const districtGeoCache = new Map<string, GeoFeature[]>();
let loadingCityId: string | null = null;

export async function initSandbox(container: HTMLElement): Promise<void> {
  if (manager) {
    manager.dispose();
    manager = null;
  }
  const data = useData.getState();
  await data.loadCore();
  if (useData.getState().error) throw new Error(useData.getState().error ?? '数据加载失败');

  const favorites = await staticRepository.loadFavorites();
  useUi.getState().hydrateFavorites(favorites);

  // 本地照片库：内容就绪后恢复索引（Tauri 记住的根目录会直接重扫；FSA 有句柄时静默校验权限）
  void usePhotoLib.getState().restore();

  // 标记（去过 / 收藏）变化时即时刷新场景中的旗子与光点
  // 订阅句柄必须存起来：StrictMode 双挂载 / HMR 会重复 initSandbox，
  // 不解绑的话每轮多一组订阅，updateMarkers() 被重复调用（每次都销毁重建整组标记）。
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.favorites !== prev.favorites) updateMarkers();
    }),
  );
  unsubscribers.push(
    useCityStatus.subscribe((s, prev) => {
      if (s.visited !== prev.visited || s.visitedDistricts !== prev.visitedDistricts) {
        updateMarkers();
      }
    }),
  );

  // 打开照片墙时暂停主场景渲染：避免与 3D 展厅双 WebGL 上下文同时渲染导致主上下文被回收（回退白屏）
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.photoWall !== prev.photoWall) manager?.setPaused(Boolean(s.photoWall));
    }),
  );

  const scene = new SceneManager();
  manager = scene;
  scene.mount(container);

  scene.onHover = (info) => {
    useNavigation.getState().setHovered(
      info ? { id: info.id, name: info.name, province: info.province, kind: info.kind } : null,
    );
  };

  scene.onPick = (info) => {
    if (info.kind === 'city') {
      void drillIntoCity(info.id);
      return;
    }
    if (info.kind === 'district') {
      void selectDistrictById(info.id);
      return;
    }
    void focusSpotById(info.id);
  };

  scene.onAnchorClick = (districtId) => {
    void selectDistrictById(districtId);
  };

  const cityGeo = useData.getState().cityGeo;
  projection = computeProjection(cityGeo);
  scene.setCityPlates(projectFeatures(cityGeo, projection));
  updateMarkers();
}

export function teardownSandbox(): void {
  for (const un of unsubscribers) un();
  unsubscribers.length = 0;
  manager?.dispose();
  manager = null;
  projection = null;
  districtGeoCache.clear();
  loadingCityId = null;
}

/** 区域总览 → 城市视图 */
export async function drillIntoCity(cityId: string): Promise<void> {
  const city = useData.getState().cities.find((c) => c.id === cityId);
  if (!city) return;
  if (!city.indexed) {
    useUi.getState().showToast(`${city.name} · 内容尚未录入，后续批次开放`);
    return;
  }
  if (!manager || !projection) return;
  if (loadingCityId === cityId) return;

  loadingCityId = cityId;
  useUi.getState().setSearchOpen(false);
  useUi.getState().closeDrawer();
  useNavigation.getState().enterCity(city);

  try {
    const geo = await loadDistrictGeo(cityId);
    if (loadingCityId !== cityId || !manager) return;
    useData.getState().registerDistrictNames(geo);
    manager.setDistrictPlates(projectFeatures(geo, projection));
    manager.setCityFocus(cityId);
    manager.selectDistrict(null);
    manager.setAnchor(null);
    refreshPins();
  } catch (err) {
    console.error(err);
    useUi.getState().showToast(`${city.name} · 区县边界加载失败`);
  } finally {
    if (loadingCityId === cityId) loadingCityId = null;
  }
}

/** 城市视图 → 区域总览 */
export function backToRegion(): void {
  const ui = useUi.getState();
  ui.closeDrawer();
  // 返回总览时城市面板会重新出现，全屏态必须清掉，否则一回去就被铺满的面板挡住地图
  ui.togglePanelFullscreen(false);
  ui.setSearchOpen(false);
  manager?.clearDistrictPlates();
  manager?.resetView();
  useNavigation.getState().backToRegion();
  useNavigation.getState().setHovered(null);
}

export function resetCamera(): void {
  manager?.resetView();
}

/** 关闭抽屉并取消区县高亮 */
export function clearDistrictSelection(): void {
  useNavigation.getState().selectDistrict(null);
  useUi.getState().closeDrawer();
  manager?.selectDistrict(null);
  manager?.focusSpot(null);
  manager?.setAnchor(null);
  refreshPins();
}

async function loadDistrictGeo(cityId: string): Promise<GeoFeature[]> {
  const cached = districtGeoCache.get(cityId);
  if (cached) return cached;
  const geo = await staticRepository.listDistrictGeo(cityId);
  districtGeoCache.set(cityId, geo);
  return geo;
}

/** 选中区县：高亮 + 聚焦 + 打开抽屉 + 拉天气 */
export async function selectDistrictById(id: string, options?: { fly?: boolean }): Promise<void> {
  const data = useData.getState();
  const district = data.districts[id];
  if (!district) {
    const raw = data.cities.flatMap((c) => c.districts).includes(id);
    if (raw) useUi.getState().showToast('该区县内容尚未录入');
    return;
  }

  const cityId = cityIdOfDistrict(district.id, district.province);
  const nav = useNavigation.getState();
  if (nav.level === 'region' || nav.currentCity?.id !== cityId) {
    await drillIntoCity(cityId);
    if (useNavigation.getState().currentCity?.id !== cityId) return;
  }

  useNavigation.getState().selectDistrict(id);
  useUi.getState().openDrawer();
  manager?.selectDistrict(id);
  manager?.focusSpot(null);
  if (options?.fly !== false) manager?.focusDistrict(id);
  manager?.setAnchor({
    id,
    name: district.name,
    city: district.city,
    spotCount: (data.spotsByDistrict[id] ?? []).length,
  });
  refreshPins();
  void useWeather.getState().ensure(district);
}

/** 搜索 / 收藏 / 卡片定位到景点 */
export async function focusSpotById(spotId: string): Promise<void> {
  const data = useData.getState();
  const spot = data.spots[spotId];
  if (!spot) return;

  const district = data.districts[spot.districtId];
  if (!district) return;

  const cityId = cityIdOfDistrict(district.id, district.province);
  const nav = useNavigation.getState();
  if (nav.level === 'region' || nav.currentCity?.id !== cityId) {
    await drillIntoCity(cityId);
    if (useNavigation.getState().currentCity?.id !== cityId) return;
  }

  useNavigation.getState().selectDistrict(spot.districtId);
  useNavigation.getState().focusSpot(spotId);
  useUi.getState().openDrawer();
  useUi.getState().openLeaf({ kind: 'spot', id: spotId });
  manager?.selectDistrict(spot.districtId);
  manager?.focusDistrict(spot.districtId);
  manager?.focusSpot(spotId);
  manager?.setAnchor({
    id: district.id,
    name: district.name,
    city: district.city,
    spotCount: (data.spotsByDistrict[district.id] ?? []).length,
  });
  refreshPins();
  void useWeather.getState().ensure(district);
}

/** 搜索命中的城市 */
export async function focusCityById(cityId: string): Promise<void> {
  await drillIntoCity(cityId);
}

/** 搜索命中的美食：定位到区县并提示高亮条目 */
export async function focusFood(districtId: string, foodName: string): Promise<void> {
  await selectDistrictById(districtId);
  const district = useData.getState().districts[districtId];
  if (!district) return;
  useUi.getState().showToast(`${district.name} · ${foodName}`);
  window.setTimeout(() => {
    const el = document.querySelector(`[data-food="${CSS.escape(foodName)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.add('is-flash');
    window.setTimeout(() => el?.classList.remove('is-flash'), 1800);
  }, 320);
}

/** 重建景点 pin（视角切换 / 区县选中后） */
export function refreshPins(): void {
  if (!manager || !projection) return;
  const nav = useNavigation.getState();
  const data = useData.getState();
  const city = nav.currentCity;
  if (nav.level !== 'city' || !city) {
    manager.setPins([]);
    updateMarkers();
    return;
  }

  const pins: PinInput[] = [];
  for (const districtId of city.districts) {
    const district = data.districts[districtId];
    if (!district) continue;
    const spots = data.spotsByDistrict[districtId] ?? [];
    for (const spot of spots) {
      const [x, y] = projectPoint(spot.lng, spot.lat, projection);
      pins.push({
        id: spot.id,
        name: spot.name,
        districtId,
        districtName: district.name,
        x,
        y,
        color: spot.hot ? 0xffb147 : 0xff9d45,
        hot: Boolean(spot.hot),
        active: nav.activeDistrictId === districtId,
        focused: nav.focusSpotId === spot.id,
      });
    }
  }
  declutterPins(pins);
  manager.setPins(pins);
  manager.selectDistrict(nav.activeDistrictId);
  manager.focusSpot(nav.focusSpotId);
  updateMarkers();
}

/**
 * 同一区县内景点相距往往不足 1 个世界单位（城市尺度下仅几像素），
 * 直接按经纬度落点会叠成一团。这里做一次有上限的柔性排斥：
 * 仅在相互重叠时推开，且每个 pin 偏离原位置不超过 maxOffset。
 */
function declutterPins(pins: PinInput[], minDist = 0.52, maxOffset = 1.15): void {
  if (pins.length < 2) return;
  const origin = pins.map((p) => [p.x, p.y] as [number, number]);
  for (let iter = 0; iter < 36; iter++) {
    let moved = false;
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i];
        const b = pins[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        moved = true;
        if (d < 1e-4) {
          const angle = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = ((minDist - d) / 2) * 0.55;
        const ux = dx / d;
        const uy = dy / d;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
      }
    }
    for (let i = 0; i < pins.length; i++) {
      const [ox, oy] = origin[i];
      const dx = pins[i].x - ox;
      const dy = pins[i].y - oy;
      const d = Math.hypot(dx, dy);
      if (d > maxOffset) {
        pins[i].x = ox + (dx / d) * maxOffset;
        pins[i].y = oy + (dy / d) * maxOffset;
      }
    }
    if (!moved) break;
  }
}

/** 关闭景点卡片并取消 pin 聚焦 */
export function clearSpotFocus(): void {
  useNavigation.getState().focusSpot(null);
  manager?.focusSpot(null);
  refreshPins();
}

/**
 * 标记刷新：
 * - 省视角：去过 = 小红旗（城市），收藏 = 粉心（城市）
 * - 城市视角：去过 = 小红旗（区县），收藏 = 粉心（区县）
 */
export function updateMarkers(): void {
  const { visited, visitedDistricts } = useCityStatus.getState();
  const favorites = useUi.getState().favorites;
  manager?.setCityMarkers([
    ...visited.map((id) => ({ id, kind: 'visited' as const })),
    ...favorites.cities.map((id) => ({ id, kind: 'favorite' as const })),
  ]);
  manager?.setDistrictMarkers([
    ...favorites.districts.map((id) => ({ id, kind: 'favorite' as const })),
    ...visitedDistricts.map((id) => ({ id, kind: 'visited' as const })),
  ]);
}

export function cityIdOfDistrict(districtId: string, province: string): string {
  if (province === '上海市') return '310000';
  return districtId.slice(0, 4) + '00';
}

// ---------- 内容导入（本地编辑） ----------

/** 导入内容 bundle：兼容导出文件，按已知区县 / 景点 id 校验后合并 */
export async function importContentBundleFile(file: File): Promise<void> {
  const ui = useUi.getState();
  try {
    const parsed = JSON.parse(await file.text()) as { districts?: unknown; spots?: unknown };
    const districts = Array.isArray(parsed.districts) ? (parsed.districts as District[]) : [];
    const spots = Array.isArray(parsed.spots) ? (parsed.spots as Spot[]) : [];
    if (districts.length === 0 && spots.length === 0) {
      ui.showToast('导入失败：文件不含区县或景点内容');
      return;
    }
    const result = await useData.getState().importContent(districts, spots);
    refreshPins();
    updateMarkers();
    ui.showToast(
      `已导入 ${result.districts} 个区县 / ${result.spots} 个景点${
        result.skipped > 0 ? `，跳过 ${result.skipped} 条无效记录` : ''
      }`,
    );
  } catch {
    ui.showToast('导入失败：不是有效的 JSON 文件');
  }
}

// ---------- 收藏清空 ----------

export function clearFavorites(): void {
  useUi.getState().replaceFavorites({ districts: [], spots: [], cities: [] });
  updateMarkers();
  useUi.getState().showToast('收藏已清空');
}

// ---------- 便于 UI 使用的小查询 ----------

export function spotsOfDistrict(districtId: string, tag: string | null): Spot[] {
  const spots = useData.getState().spotsByDistrict[districtId] ?? [];
  return tag ? spots.filter((s) => s.tags.includes(tag as Spot['tags'][number])) : spots;
}

export function districtById(id: string | null): District | null {
  return id ? (useData.getState().districts[id] ?? null) : null;
}

export function cityOfDistrict(d: District): City | undefined {
  return useData.getState().cities.find((c) => c.id === cityIdOfDistrict(d.id, d.province));
}

// ---------- 调试钩子（本地单机应用，便于自动化回归测试驱动 UI） ----------
declare global {
  interface Window {
    __sandboxApp?: Record<string, unknown>;
  }
}
if (typeof window !== 'undefined') {
  window.__sandboxApp = {
    selectDistrictById,
    focusSpotById,
    focusCityById,
    backToRegion,
    resetCamera: () => manager?.resetView(),
    /** 最近一次取景的尺寸 / 距离，供回归脚本核对「地图是否完整进屏」 */
    lastFrame: () => manager?.lastFrame ?? null,
    openPhotoWall: (arg: { scope: 'city' | 'district'; id: string; title: string }) =>
      useUi.getState().openPhotoWall(arg),
  };
}
