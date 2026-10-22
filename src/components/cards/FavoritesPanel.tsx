import { useEffect, useState } from 'react';
import { useCityStatus } from '../../stores/cityStatus';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import {
  clearFavorites,
  clearSpotFocus,
  focusCityById,
  focusSpotById,
  selectDistrictById,
} from '../../app/sandbox';
import { VisitedMark } from '../shared/VisitedMark';
import { HeartMark } from '../shared/HeartMark';

interface Row {
  key: string;
  name: string;
  sub: string;
  kind: 'visited' | 'favorite';
  go: () => void;
  remove?: () => void;
}

export function FavoritesPanel() {
  const open = useUi((s) => s.favoritesOpen);
  const favorites = useUi((s) => s.favorites);
  const toggle = useUi((s) => s.toggleFavorite);
  const close = useUi((s) => s.toggleFavoritesPanel);
  const toggleTimelinePanel = useUi((s) => s.toggleTimelinePanel);
  const toggleTravelPanel = useUi((s) => s.toggleTravelPanel);
  const districts = useData((s) => s.districts);
  const spots = useData((s) => s.spots);
  const cities = useData((s) => s.cities);
  const cityVisited = useCityStatus((s) => s.visited);
  const visitedDistricts = useCityStatus((s) => s.visitedDistricts);
  const toggleCityVisited = useCityStatus((s) => s.toggleVisited);
  const toggleVisitedDistrict = useCityStatus((s) => s.toggleVisitedDistrict);
  const [confirmClear, setConfirmClear] = useState(false);

  const closeTo = (fn: () => void) => {
    close(false);
    fn();
  };

  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  if (!open) return null;

  const cityById = new Map(cities.map((c) => [c.id, c]));

  const visitedCityRows: Row[] = cityVisited.flatMap((id) => {
    const city = cityById.get(id);
    if (!city) return [];
    return [
      {
        key: `vc-${id}`,
        name: city.name,
        sub: `${city.province} · ${city.districts.length} 区县`,
        kind: 'visited',
        go: () => {
          close(false);
          void focusCityById(id);
        },
        remove: () => toggleCityVisited(id),
      },
    ];
  });

  const visitedDistrictRows: Row[] = visitedDistricts.flatMap((id) => {
    const d = districts[id];
    if (!d) return [];
    return [
      {
        key: `vd-${id}`,
        name: d.name,
        sub: `${d.city} · ${d.tags.join(' / ')}`,
        kind: 'visited',
        go: () => {
          close(false);
          void selectDistrictById(id);
        },
        remove: () => toggleVisitedDistrict(id),
      },
    ];
  });

  const favCities = favorites.cities.map((id) => cityById.get(id)).filter(Boolean) as typeof cities;
  const favDistricts = favorites.districts.map((id) => districts[id]).filter(Boolean);
  const favSpots = favorites.spots.map((id) => spots[id]).filter(Boolean);

  const favCityRows: Row[] = favCities.map((c) => ({
    key: `fc-${c.id}`,
    name: c.name,
    sub: `${c.province} · ${c.districts.length} 区县`,
    kind: 'favorite',
    go: () => {
      closeTo(() => void focusCityById(c.id));
    },
    remove: () => toggle('city', c.id),
  }));

  const favDistrictRows: Row[] = favDistricts.map((d) => ({
    key: `fd-${d.id}`,
    name: d.name,
    sub: `${d.city} · ${d.tags.join(' / ')}`,
    kind: 'favorite',
    go: () => {
      closeTo(() => void selectDistrictById(d.id));
    },
    remove: () => toggle('district', d.id),
  }));

  const favSpotRows: Row[] = favSpots.map((s) => ({
    key: `fs-${s.id}`,
    name: s.name,
    sub: `${districts[s.districtId]?.name ?? ''} · ${s.tags.join(' / ')}`,
    kind: 'favorite',
    go: () => {
      closeTo(() => {
        clearSpotFocus();
        void focusSpotById(s.id);
      });
    },
    remove: () => toggle('spot', s.id),
  }));

  const sections: { title: string; rows: Row[]; empty: string }[] = [
    {
      title: '去过的城市',
      rows: visitedCityRows,
      empty: '还没有标记去过的城市。打开城市面板，点「去过」即可记录。',
    },
    {
      title: '收藏的城市',
      rows: favCityRows,
      empty: '还没有收藏的城市。打开城市面板，点心形图标即可收藏。',
    },
    {
      title: '去过的区县',
      rows: visitedDistrictRows,
      empty: '还没有标记去过的区县。打开区县抽屉，点小红旗即可记录。',
    },
    {
      title: '收藏的区县',
      rows: favDistrictRows,
      empty: '还没有收藏的区县。打开任意区县抽屉，点心形图标即可加入。',
    },
    {
      title: '收藏的景点',
      rows: favSpotRows,
      empty: '还没有收藏的景点。打开景点卡片，点「收藏」即可加入这份清单。',
    },
  ];

  const total =
    visitedCityRows.length +
    favCityRows.length +
    visitedDistrictRows.length +
    favDistrictRows.length +
    favSpotRows.length;

  const renderRows = (rows: Row[]) =>
    rows.length === 0 ? null : (
      <ul className="fav-list">
        {rows.map((r) => (
          <li key={r.key}>
            <button className="fav-item" onClick={r.go}>
              <span className="fav-item-mark">
                {r.kind === 'visited' ? <VisitedMark on /> : <HeartMark on />}
              </span>
              <span className="fav-item-body">
                <span className="fav-item-name">{r.name}</span>
                <span className="fav-item-sub">{r.sub}</span>
              </span>
            </button>
            {r.remove && (
              <button className="fav-remove" onClick={r.remove} title="移除">
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <section className="fav-panel" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fav-head">
          <div>
            <div className="drawer-kicker">足迹与收藏</div>
            <div className="fav-title-line">
              <h2 className="drawer-title">足迹与收藏</h2>
              <span className="fav-total">{total}</span>
            </div>
            <p className="fav-wander">你提过的好地方，我标在地图上，等哪一天我带你去流浪，流浪。</p>
          </div>
          <button className="icon-btn" onClick={() => close(false)} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="fav-body">
          {sections.map((sec) => (
            <div className="fav-section" key={sec.title}>
              <h3 className="block-title">
                <i />
                {sec.title}
                <span className="block-count">{sec.rows.length}</span>
              </h3>
              {sec.rows.length === 0 ? (
                <p className="block-empty">{sec.empty}</p>
              ) : (
                renderRows(sec.rows)
              )}
            </div>
          ))}
        </div>

        <footer className="fav-foot">
          <div className="fav-foot-actions">
            <button
              className={`ghost-btn${confirmClear ? ' is-danger' : ''}`}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                clearFavorites();
                setConfirmClear(false);
              }}
            >
              {confirmClear ? '确认清空收藏？' : '清空收藏'}
            </button>
            <button className="ghost-btn" onClick={() => closeTo(() => toggleTimelinePanel(true))} title="查看到访时间线">
              🕘 时间线
            </button>
            <button className="ghost-btn" onClick={() => closeTo(() => toggleTravelPanel(true))} title="查看 / 写游记">
              ✎ 游记
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
