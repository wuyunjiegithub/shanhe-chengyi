import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { useCityStatus } from '../../stores/cityStatus';
import { useVisitLog } from '../../stores/visitLog';
import { clearDistrictSelection, focusSpotById } from '../../app/sandbox';
import { TAG_COLOR } from '../shared/meta';
import { BgImage } from '../shared/BgImage';
import { bgKey } from '../../stores/backgrounds';
import { VisitedMark } from '../shared/VisitedMark';
import { HeartMark } from '../shared/HeartMark';
import { WeatherCard } from './WeatherCard';

function fmtDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DistrictDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const favorites = useUi((s) => s.favorites);
  const toggleFavorite = useUi((s) => s.toggleFavorite);
  const openTravelWithPlace = useUi((s) => s.openTravelWithPlace);
  const openLeaf = useUi((s) => s.openLeaf);
  const openPhotoWall = useUi((s) => s.openPhotoWall);
  const activeDistrictId = useNavigation((s) => s.activeDistrictId);
  const districts = useData((s) => s.districts);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);
  const visitedDistricts = useCityStatus((s) => s.visitedDistricts);
  const toggleVisitedDistrict = useCityStatus((s) => s.toggleVisitedDistrict);
  const visitRecords = useVisitLog((s) => s.records);
  const logVisitAt = useVisitLog((s) => s.logVisitAt);
  const removeRecord = useVisitLog((s) => s.removeRecord);
  const district = activeDistrictId ? districts[activeDistrictId] : null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visitDate, setVisitDate] = useState('');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeDistrictId]);

  const allSpots = district ? (spotsByDistrict[district.id] ?? []) : [];
  const districtFoods = district?.foods ?? [];
  const specialties = district?.specialties ?? [];
  const spots = allSpots.sort((a, b) => Number(Boolean(b.hot)) - Number(Boolean(a.hot)));
  const favored = district ? favorites.districts.includes(district.id) : false;
  const visitedDistrict = district ? visitedDistricts.includes(district.id) : false;
  const districtVisits = district
    ? visitRecords
        .filter((r) => r.kind === 'district' && r.placeId === district.id)
        .sort((a, b) => b.at - a.at)
    : [];

  return (
    <aside className={`drawer${open && district ? ' is-open' : ''}`} aria-hidden={!open}>
      {district && (
        <div className="drawer-inner">
          <header className="drawer-head">
            <div className="drawer-title-wrap">
              <div className="drawer-kicker">
                {district.province} · {district.city}
              </div>
              <h2 className="drawer-title">{district.name}</h2>
            </div>
            <div className="drawer-head-actions">
              <button
                className={`icon-btn icon-btn--fav${favored ? ' is-on' : ''}`}
                title={favored ? '取消收藏该区县' : '收藏该区县'}
                onClick={() => toggleFavorite('district', district.id)}
              >
                <HeartMark on={favored} />
              </button>
              <button
                className={`icon-btn icon-btn--visited${visitedDistrict ? ' is-on' : ''}`}
                title={visitedDistrict ? '取消「去过」标记' : '标记去过（插小红旗）'}
                onClick={() => toggleVisitedDistrict(district.id)}
              >
                <VisitedMark on={visitedDistrict} />
              </button>
              <button className="icon-btn" title="关闭" onClick={clearDistrictSelection}>
                ×
              </button>
            </div>
          </header>

          <div className="drawer-cover">
            <BgImage
              bgKey={bgKey('district', district.id)}
              src={district.image ?? `/assets/districts/${district.id}.jpg`}
              alt={district.name}
              label={district.name}
              tags={district.tags}
              className="drawer-cover-img"
              editable
            />
            <div className="drawer-cover-grad" />
          </div>

          <div className="drawer-scroll" ref={scrollRef} key={district.id}>
            <WeatherCard district={district} />

            <p className="drawer-oneliner">{district.oneLiner}</p>

            <div className="tag-row">
              {district.tags.map((tag) => (
                <span
                  key={tag}
                  className="chip"
                  style={
                    {
                      '--tag-color': TAG_COLOR[tag],
                    } as CSSProperties
                  }
                >
                  {tag}
                </span>
              ))}
            </div>

            <section className="content-block">
              <h3 className="block-title">
                <i />历史
              </h3>
              <p>{district.history ?? '待补充'}</p>
            </section>

            <section className="content-block">
              <h3 className="block-title">
                <i />人文
              </h3>
              <p>{district.culture ?? '待补充'}</p>
            </section>

            {district.people && district.people.length > 0 && (
              <section className="content-block">
                <h3 className="block-title">
                  <i />名人
                </h3>
                <ul className="people-list">
                  {district.people.map((p) => (
                    <li key={p.name}>
                      <b>{p.name}</b>
                      <span>{p.note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {district.features && district.features.length > 0 && (
              <section className="content-block">
                <h3 className="block-title">
                  <i />特色
                </h3>
                <div className="feature-list">
                  {district.features.map((f) => (
                    <span key={f} className="feature-chip">
                      {f}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section className="content-block">
              <h3 className="block-title">
                <i />主要景点
                <span className="block-count">{spots.length}</span>
              </h3>
              {spots.length === 0 ? (
                <p className="block-empty">景点待录入。</p>
              ) : (
                <div className="spot-list">
                  {spots.map((spot, i) => (
                    <button key={spot.id} className="spot-row" onClick={() => void focusSpotById(spot.id)}>
                      <span className="spot-thumb">
            <BgImage
              bgKey={bgKey('spot', spot.id)}
              src={spot.image ?? `/assets/spots/${spot.id}.jpg`}
              alt={spot.name}
              label={spot.name}
              tags={spot.tags}
            />
                        {spot.hot && <em className="spot-rank">{i + 1}</em>}
                      </span>
                      <span className="spot-main">
                        <span className="spot-name">
                          {spot.name}
                          {spot.hot && <em className="hot-badge">热门</em>}
                        </span>
                        <span className="spot-summary">{spot.summary}</span>
                        <span className="spot-tags">
                          {spot.tags.map((t) => (
                            <i key={t}>{t}</i>
                          ))}
                          {spot.duration && <i className="is-plain">{spot.duration}</i>}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="content-block">
              <h3 className="block-title">
                <i />当地美食
                <span className="block-count">{districtFoods.length}</span>
              </h3>
              {districtFoods.length === 0 ? (
                <p className="block-empty">本区县美食待录入，可到「数据」面板补充。</p>
              ) : (
                <div className="food-grid">
                  {districtFoods.map((food) => (
                    <button
                      key={food.name}
                      className="food-card"
                      data-food={food.name}
                      onClick={() => openLeaf({ kind: 'food', districtId: district.id, name: food.name })}
                    >
                      <BgImage
                        bgKey={bgKey('food', 'district', district.id, food.name)}
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
                    </button>
                  ))}
                </div>
              )}
            </section>

            {specialties.length > 0 && (
              <section className="content-block">
                <h3 className="block-title">
                  <i />特产 · 非遗
                  <span className="block-count">{specialties.length}</span>
                </h3>
                <div className="specialty-list">
                  {specialties.map((sp) => (
                    <div
                      key={`${sp.kind}-${sp.name}`}
                      className={`specialty-card specialty-card--${sp.kind === '非遗' ? 'heritage' : 'local'}`}
                    >
                      <span className="specialty-kind">{sp.kind}</span>
                      <span className="specialty-name">{sp.name}</span>
                      <span className="specialty-note">{sp.note}</span>
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
                onClick={() => openPhotoWall({ scope: 'district', id: district.id, title: `${district.name} · 照片墙` })}
              >
                <span className="photo-wall-trigger-ico">▦</span>
                打开 {district.name} 照片墙
              </button>
            </section>

            <section className="content-block">
              <h3 className="block-title">
                <i />到访时间
                <span className="block-count">{districtVisits.length}</span>
              </h3>
              {districtVisits.length === 0 ? (
                <p className="block-empty">
                  还没有到访记录。点上方「去过」会自动记一次；也可以手动补充具体的到访日期。
                </p>
              ) : (
                <ul className="visit-list">
                  {districtVisits.map((r) => (
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
                    logVisitAt('district', district.id, t);
                    setVisitDate('');
                  }}
                >
                  添加这次到访
                </button>
              </div>
            </section>

            <div className="drawer-actions">
              <button className="primary-btn" onClick={() => toggleFavorite('district', district.id)}>
                {favored ? '♥ 已收藏该区县' : '♡ 收藏该区县'}
              </button>
              <button
                className="ghost-btn"
                onClick={() =>
                  openTravelWithPlace({ kind: 'district', id: district.id, name: district.name })
                }
              >
                ✎ 写游记
              </button>
            </div>

            <footer className="drawer-source">
              <span>资料来源：{district.source ?? '本地整理'}</span>
              <span>更新于 {district.updatedAt}</span>
            </footer>
          </div>
        </div>
      )}
    </aside>
  );
}
