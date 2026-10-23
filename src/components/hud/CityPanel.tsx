import { useEffect, useMemo, useRef } from 'react';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { useCityStatus } from '../../stores/cityStatus';
import { useData } from '../../stores/data';
import { updateMarkers } from '../../app/sandbox';
import { BgImage } from '../shared/BgImage';
import { bgKey } from '../../stores/backgrounds';
import { WeatherCard } from '../drawer/WeatherCard';
import { PlaceHeader, PhotoWallBlock, VisitLogSection, WriteNoteBar } from '../shared/PlaceBlocks';
import { useBottomSheet } from '../shared/useBottomSheet';
import type { City } from '../../data/types';

export function CityPanel() {
  const level = useNavigation((s) => s.level);
  const city = useNavigation((s) => s.currentCity) as City | null;
  const drawerOpen = useUi((s) => s.drawerOpen);
  const panelFullscreen = useUi((s) => s.panelFullscreen);
  const togglePanelFullscreen = useUi((s) => s.togglePanelFullscreen);
  const cityPanelDismissed = useUi((s) => s.cityPanelDismissed);
  const setCityPanelDismissed = useUi((s) => s.setCityPanelDismissed);
  const favorites = useUi((s) => s.favorites);
  const toggleFavorite = useUi((s) => s.toggleFavorite);
  const visited = useCityStatus((s) => s.visited);
  const toggleVisited = useCityStatus((s) => s.toggleVisited);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheet = useBottomSheet(level === 'city' && !!city && !drawerOpen, panelFullscreen);
  // 城市没有 District 实体，用其下各区县的质心（平均经纬度）作为天气定位点
  const allDistricts = useData((s) => s.districts);
  // 城市美食榜只显示城市自己编辑的那份（城市级信息统一在「内容编辑器」里改，
  // 不再聚合下属区县美食 —— 区县美食归区县，各看各的）
  const cityFoods = city?.foods ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [city?.id]);

  // 关键：useMemo 必须在上面的「提前 return null」之前调用。否则省视角（走 return null，
  // 不调用 useMemo）切到城市视图（调用 useMemo）时钩子数量突变，触发 React
  // "Rendered more hooks than during the previous render"，整棵 UI 树卸载 → 点市后整屏黑。
  const cityName = city?.name;
  const cityCenter = useMemo<[number, number] | null>(() => {
    if (!cityName) return null;
    const ds = Object.values(allDistricts).filter((d) => d.city === cityName && d.center);
    if (ds.length === 0) return null;
    const sum = ds.reduce(
      (acc, d) => {
        const c = d.center as [number, number];
        return [acc[0] + c[0], acc[1] + c[1]] as [number, number];
      },
      [0, 0] as [number, number],
    );
    return [sum[0] / ds.length, sum[1] / ds.length];
  }, [allDistricts, cityName]);

  if (level !== 'city' || !city || drawerOpen || cityPanelDismissed) return null;

  const isVisited = visited.includes(city.id);
  const isFav = favorites.cities.includes(city.id);

  const onVisited = () => {
    toggleVisited(city.id);
    updateMarkers();
  };
  const onFav = () => {
    toggleFavorite('city', city.id);
    updateMarkers();
  };
  // 右上角 ×：仅收起面板、保留当前下钻的城市视图（地图不飞回区域总览）。
  // 真正复位由 ESC / 返回键 / 顶栏「总览」负责，符合「关闭详情不重置地图」的诉求。
  const onClose = () => {
    togglePanelFullscreen(false);
    setCityPanelDismissed(true);
  };

  return (
    <aside
      className={`city-panel hud${panelFullscreen ? ' is-full' : ''}`}
      style={sheet.rootStyle}
    >
      <div className="sheet-grabber" {...sheet.bind} aria-hidden="true" />
      <PlaceHeader
        kicker={city.province}
        name={city.name}
        favored={isFav}
        visited={isVisited}
        onToggleFav={onFav}
        onToggleVisited={onVisited}
        onClose={onClose}
        favTitleOff="收藏这座城市"
        favTitleOn="取消收藏这座城市"
        visitedTitleOff="标记去过这座城市"
        closeTitle="关闭城市概览，返回江浙沪皖总览"
      />

      <div className="city-panel-scroll" ref={scrollRef}>
        <div className="city-cover">
          <BgImage
            bgKey={bgKey('city', city.id)}
            src={city.banner}
            alt={`${city.name}封面`}
            label={city.name}
            className="city-cover-img"
            editable
          />
          <div className="city-cover-grad" />
        </div>

        {city.poem && (
          <section className="city-poem">
            <span className="city-poem-mark">“</span>
            <p className="city-poem-text">{city.poem}</p>
            {city.poemFrom && <span className="city-poem-from">— {city.poemFrom}</span>}
          </section>
        )}

        <p className="city-intro">{city.intro || '按区县逐级浏览历史、人文与可玩地点。'}</p>

        {cityCenter && <WeatherCard id={`city:${city.id}`} center={cityCenter} />}

        {city.urbanDistricts && city.urbanDistricts.length > 0 && (
          <section className="content-block city-urban">
            <h3 className="block-title">
              <i />城区
            </h3>
            <div className="city-urban-chips">
              {city.urbanDistricts.map((u) => (
                <span key={u.id} className="city-urban-chip">
                  {u.name.replace(/区$|县$|市$/, '')}
                </span>
              ))}
            </div>
            {city.urbanNote && <p className="city-urban-note">{city.urbanNote}</p>}
          </section>
        )}

        {cityFoods.length > 0 && (
          <section className="content-block city-foods">
            <h3 className="block-title">
              <i />城市美食榜
              <span className="block-count">{cityFoods.length}</span>
            </h3>
            <div className="food-grid">
              {cityFoods.map((food) => (
                <div key={`city:${food.name}`} className="food-card">
                  <BgImage
                    bgKey={bgKey('food', 'city', city.id, food.name)}
                    src={food.image}
                    alt={food.name}
                    label={food.name}
                    className="food-card-img"
                    editable
                    size="sm"
                  />
                  <div className="food-card-body">
                    <span className="food-card-name">{food.name}</span>
                    <span className="food-card-cat">{food.category}</span>
                    <span className="food-card-note">{food.note}</span>
                    <span className="food-card-rec">📍 {food.recommend}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <PhotoWallBlock scope="city" id={city.id} title={city.name} />

        <VisitLogSection
          kind="city"
          placeId={city.id}
          emptyHint="还没有游玩记录。点右上角「去过」会自动记一次；也可以手动补充具体的游玩日期，支持起止范围。"
        />
      </div>

      <WriteNoteBar kind="city" id={city.id} name={city.name} />
    </aside>
  );
}
