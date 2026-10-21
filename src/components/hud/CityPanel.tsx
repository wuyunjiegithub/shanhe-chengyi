import { useEffect, useRef, useState } from 'react';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { useCityStatus } from '../../stores/cityStatus';
import { useVisitLog } from '../../stores/visitLog';
import { updateMarkers } from '../../app/sandbox';
import { BgImage } from '../shared/BgImage';
import { bgKey } from '../../stores/backgrounds';
import { VisitedMark } from '../shared/VisitedMark';
import { HeartMark } from '../shared/HeartMark';
import type { City } from '../../data/types';

function fmtDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CityPanel() {
  const level = useNavigation((s) => s.level);
  const city = useNavigation((s) => s.currentCity) as City | null;
  const drawerOpen = useUi((s) => s.drawerOpen);
  const openPhotoWall = useUi((s) => s.openPhotoWall);
  const openTravelWithPlace = useUi((s) => s.openTravelWithPlace);
  const favorites = useUi((s) => s.favorites);
  const toggleFavorite = useUi((s) => s.toggleFavorite);
  const visited = useCityStatus((s) => s.visited);
  const toggleVisited = useCityStatus((s) => s.toggleVisited);
  const visitRecords = useVisitLog((s) => s.records);
  const logVisitAt = useVisitLog((s) => s.logVisitAt);
  const removeRecord = useVisitLog((s) => s.removeRecord);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visitDate, setVisitDate] = useState('');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [city?.id]);

  if (level !== 'city' || !city || drawerOpen) return null;

  const isVisited = visited.includes(city.id);
  const isFav = favorites.cities.includes(city.id);
  const cityVisits = visitRecords
    .filter((r) => r.kind === 'city' && r.placeId === city.id)
    .sort((a, b) => b.at - a.at);

  const onVisited = () => {
    toggleVisited(city.id);
    updateMarkers();
  };
  const onFav = () => {
    toggleFavorite('city', city.id);
    updateMarkers();
  };

  return (
    <aside className="city-panel hud">
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
          <div className="city-cover-head">
            <span className="city-cover-prov">{city.province}</span>
            <h2 className="city-cover-name">{city.name}</h2>
          </div>
        </div>

        {city.poem && (
          <section className="city-poem">
            <span className="city-poem-mark">“</span>
            <p className="city-poem-text">{city.poem}</p>
            {city.poemFrom && <span className="city-poem-from">— {city.poemFrom}</span>}
          </section>
        )}

        <p className="city-intro">{city.intro || '按区县逐级浏览历史、人文与可玩地点。'}</p>

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

        {city.foods && city.foods.length > 0 && (
          <section className="content-block city-foods">
            <h3 className="block-title">
              <i />城市美食榜
              <span className="block-count">{city.foods.length}</span>
            </h3>
            <div className="food-grid">
              {city.foods.map((food) => (
                <div key={food.name} className="food-card">
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

        <section className="content-block">
          <h3 className="block-title">
            <i />照片墙
          </h3>
          <button
            className="photo-wall-trigger"
            onClick={() => openPhotoWall({ scope: 'city', id: city.id, title: `${city.name} · 照片墙` })}
          >
            <span className="photo-wall-trigger-ico">▦</span>
            打开 {city.name} 照片墙
          </button>
        </section>
        <section className="content-block">
          <h3 className="block-title">
            <i />到访时间
            <span className="block-count">{cityVisits.length}</span>
          </h3>
          {cityVisits.length === 0 ? (
            <p className="block-empty">
              还没有到访记录。点下方「标记去过」会自动记一次；也可以手动补充具体的到访日期。
            </p>
          ) : (
            <ul className="visit-list">
              {cityVisits.map((r) => (
                <li key={r.id} className="visit-row">
                  <span className="visit-date">{fmtDate(r.at)}</span>
                  <button className="visit-del" title="删除这条到访记录" onClick={() => removeRecord(r.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="visit-add">
            <input
              type="date"
              className="visit-date-input"
              value={visitDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setVisitDate(e.target.value)}
            />
            <button
              className="ghost-btn"
              disabled={!visitDate}
              onClick={() => {
                if (!visitDate) return;
                const t = new Date(`${visitDate}T12:00:00`).getTime();
                logVisitAt('city', city.id, t);
                setVisitDate('');
              }}
            >
              添加这次到访
            </button>
          </div>
        </section>
      </div>

      <div className="city-actions">
        <button
          className={`city-act city-act--flag${isVisited ? ' is-on' : ''}`}
          onClick={onVisited}
          title={isVisited ? '取消「去过」标记' : '标记去过'}
        >
          <VisitedMark on={isVisited} />
          {isVisited ? '去过' : '标记去过'}
        </button>
        <button
          className={`city-act city-act--fav${isFav ? ' is-on' : ''}`}
          onClick={onFav}
          title={isFav ? '取消收藏' : '收藏城市'}
        >
          <HeartMark on={isFav} />
          {isFav ? '已收藏' : '收藏'}
        </button>
        <button
          className="city-act city-act--note"
          onClick={() => openTravelWithPlace({ kind: 'city', id: city.id, name: city.name })}
          title="为这座城市写一篇游记"
        >
          ✎ 写游记
        </button>
      </div>
    </aside>
  );
}
