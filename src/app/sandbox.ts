import { SceneManager } from '../scene/SceneManager';
import { createTerrain } from '../scene/terrain';
import { loadTerrainData } from '../data/terrain';
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
import { liveWeatherKind } from '../components/shared/meta';
import type { WeatherKind } from '../data/types';
import { usePhotoLib } from '../stores/photoLib';

let manager: SceneManager | null = null;
/** 各 store 的订阅句柄，teardownSandbox 时统一解绑（否则重复 initSandbox 会叠加订阅） */
const unsubscribers: Array<() => void> = [];
let projection: Projection | null = null;
const districtGeoCache = new Map<string, GeoFeature[]>();
let loadingCityId: string | null = null;
/** 每小时刷新一次当前可见层天气（用户要求：每小时刷新） */
let weatherTimer: number | null = null;

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

  // 地形图层开关：用户在「设置 → 地图图层」里切换
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.terrain !== prev.terrain) manager?.setTerrainVisible(s.terrain);
    }),
  );

  // 「去过」标记样式：设置面板切换后立刻换脸，不用等下次重建标记
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.visitedStyle !== prev.visitedStyle) manager?.setVisitedStyle(s.visitedStyle);
    }),
  );

  // 打开照片墙时暂停主场景渲染：避免与 3D 展厅双 WebGL 上下文同时渲染导致主上下文被回收（回退白屏）
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.photoWall !== prev.photoWall) manager?.setPaused(Boolean(s.photoWall));
    }),
  );

  // 天气缓存变化（联网返回 / 每小时刷新）后，重新把天气画到地图上
  unsubscribers.push(
    useWeather.subscribe((s, prev) => {
      if (s.cache !== prev.cache) applyWeatherToScene();
    }),
  );

  // 天气图层开关：用户在「设置 → 地图图层」里切换
  unsubscribers.push(
    useUi.subscribe((s, prev) => {
      if (s.weather !== prev.weather) manager?.setWeatherVisible(s.weather);
    }),
  );

  // 每小时强制刷新当前可见层天气（走 refreshAt 忽略 3h 缓存）
  weatherTimer = window.setInterval(() => {
    if (!manager || !useUi.getState().weather) return;
    for (const t of visibleWeatherTargets()) {
      void useWeather
        .getState()
        .refreshAt(t.id, t.lat, t.lng)
        .then(applyWeatherToScene)
        .catch(() => {});
    }
  }, 3600_000);

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
  const proj = projection;
  // 标记样式要在第一批标记建出来之前就位，否则首屏会先闪一下默认旗子
  scene.setVisitedStyle(useUi.getState().visitedStyle);
  scene.setCityPlates(projectFeatures(cityGeo, proj));
  // 天气图层：省视角默认展示各城市天气（按需联网，命中缓存立即返回）
  void refreshWeather();
  // 地形图层（真实高程 / 湖岸线 / 河道）：与板块共用同一投影，精确落在对应陆/水之上。
  // 数据体积约 500KB，异步加载；加载失败只是少一层观感，不影响地图主功能。
  void loadTerrainData().then((terrain) => {
    if (!terrain || manager !== scene) return;
    scene.setTerrain(createTerrain(proj, terrain));
    scene.setTerrainVisible(useUi.getState().terrain);
  });
  updateMarkers();
}

export function teardownSandbox(): void {
  for (const un of unsubscribers) un();
  unsubscribers.length = 0;
  if (weatherTimer !== null) {
    window.clearInterval(weatherTimer);
    weatherTimer = null;
  }
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
  // 进入（或重新进入）任意城市时复位「城市面板收起」状态，保证面板会显示出来
  useUi.getState().setCityPanelDismissed(false);
  if (loadingCityId === cityId) return;

  loadingCityId = cityId;
  useUi.getState().setSearchOpen(false);
  useUi.getState().closeDrawer();
  useNavigation.getState().enterCity(city);

  try {
    const geo = await loadDistrictGeo(cityId);
    if (loadingCityId !== cityId || !manager) return;
    useData.getState().registerDistrictNames(geo);
    // 手机上进入城市即展开底部半屏详情，取景预留面板高度，让城市落在屏幕上半部分
    manager.setPanelExpanded(true);
    manager.setDistrictPlates(projectFeatures(geo, projection));
    manager.setCityFocus(cityId);
    void refreshWeather();
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
  // 复位「城市面板收起」状态，保证回到区域总览后再次下钻能正常显示面板
  ui.setCityPanelDismissed(false);
  ui.setSearchOpen(false);
  manager?.clearDistrictPlates();
  // 复位取景预留（无面板），让区域总览按整屏取景
  manager?.setPanelExpanded(false);
  manager?.resetView();
  void refreshWeather();
  useNavigation.getState().backToRegion();
  useNavigation.getState().setHovered(null);
}

export function resetCamera(): void {
  manager?.resetView();
}

/** 顶栏「总览」：收起所有详情与浮层，回到区域总览 */
export function goToOverview(): void {
  backToRegion();
  const ui = useUi.getState();
  ui.toggleFavoritesPanel(false);
  ui.toggleTimelinePanel(false);
  ui.toggleTravelPanel(false);
  ui.toggleDataPanel(false);
  ui.toggleSettings(false);
  ui.setSearchOpen(false);
  ui.setDistrictPickerOpen(false);
  ui.closePhotoWall();
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
  // 手机上区县详情是底部半屏，取景预留面板高度，让区县落在屏幕上半部分
  manager?.setPanelExpanded(true);
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
  const data = useData.getState();
  // 区县去过时，其所属城市也要在全景上插上小红旗（用户标注了淳安，杭州就该插旗）
  // 注意：内容里 district.city 存的是城市**名称**（"杭州市"），不是 id，
  // 直接塞进 id 集合会因 setCityMarkers 按 id 取不到而被静默丢弃 ——
  // 这正是「标了淳安、省视角杭州没有旗子」的原因。统一按行政区划编码前 4 位推城市 id。
  const cityIds = new Set(data.cities.map((c) => c.id));
  const visitedCities = new Set(visited);
  for (const did of visitedDistricts) {
    const d = data.districts[did];
    const cityId = cityIdOfDistrict(did, d?.province ?? '');
    if (cityIds.has(cityId)) visitedCities.add(cityId);
  }
  manager?.setCityMarkers([
    ...[...visitedCities].map((id) => ({ id, kind: 'visited' as const })),
    ...favorites.cities.map((id) => ({ id, kind: 'favorite' as const })),
  ]);
  manager?.setDistrictMarkers([
    ...favorites.districts.map((id) => ({ id, kind: 'favorite' as const })),
    ...visitedDistricts.map((id) => ({ id, kind: 'visited' as const })),
  ]);
}

export function cityIdOfDistrict(districtId: string, province: string): string {
  // 区县码前 4 位即所属地级市：330127（淳安）→ 330100（杭州）
  // 直辖市没有地级市这一层，上海 310101 → 310000（按码前 2 位兜底，未录入区县也能推）
  if (province === '上海市' || districtId.startsWith('31')) return '310000';
  return districtId.slice(0, 4) + '00';
}

// ---------- 天气图层 ----------

/** 当前可见层需要拉天气的目标（城市视角 = 该城市各区县；省视角 = 各城市，取区县质心均值算经纬度） */
function visibleWeatherTargets(): { id: string; lat: number; lng: number }[] {
  const nav = useNavigation.getState();
  const data = useData.getState();
  if (nav.level === 'city' && nav.currentCity) {
    const out: { id: string; lat: number; lng: number }[] = [];
    for (const did of nav.currentCity.districts) {
      const d = data.districts[did];
      if (d?.center) out.push({ id: d.id, lat: d.center[1], lng: d.center[0] });
    }
    return out;
  }
  const out: { id: string; lat: number; lng: number }[] = [];
  for (const c of data.cities) {
    const pts = c.districts
      .map((id) => data.districts[id]?.center)
      .filter((p): p is [number, number] => Boolean(p));
    if (!pts.length) continue;
    const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    out.push({ id: `city:${c.id}`, lat, lng });
  }
  return out;
}

/** 把当前天气缓存画到地图：城市级用 city:<id> 作 key，区县用 districtId */
function applyWeatherToScene(): void {
  if (!manager) return;
  const cache = useWeather.getState().cache;
  const targets = visibleWeatherTargets();
  const items = targets
    .map((t) => {
      const kind = liveWeatherKind(cache[t.id]);
      return kind ? { id: t.id, kind } : null;
    })
    .filter(Boolean) as { id: string; kind: WeatherKind }[];
  manager.setWeather(items);
  const sev: Record<WeatherKind, number> = { sunny: 0, cloudy: 1, overcast: 2, fog: 3, rain: 4, snow: 5 };
  let agg: WeatherKind | null = null;
  for (const it of items) {
    if (agg === null || sev[it.kind] > sev[agg]) agg = it.kind;
  }
  manager.setWeatherAmbience(agg);
}

/** 拉取当前可见层天气（命中 3h 缓存立即返回，否则联网），完成后重绘 */
async function refreshWeather(): Promise<void> {
  const targets = visibleWeatherTargets();
  await Promise.all(
    targets.map((t) => useWeather.getState().ensureAt(t.id, t.lat, t.lng).catch(() => {})),
  );
  applyWeatherToScene();
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
    /** 打开游记编辑器（带预置地点），供回归脚本核对富文本工具栏是否被正文滚动带走 */
    openTravelEditor: (prefill: { kind: 'city' | 'district'; id: string; name: string }) =>
      useUi.getState().openTravelWithPlace(prefill),
    /** 只打开游记列表（不带预置地点），供回归脚本核对列表封面与标题口径 */
    openTravelList: () => useUi.getState().toggleTravelPanel(true),
  };
}
