import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { useCityStatus } from '../../stores/cityStatus';
import { clearDistrictSelection, focusSpotById } from '../../app/sandbox';
import { TAG_COLOR } from '../shared/meta';
import { BgImage } from '../shared/BgImage';
import { bgKey } from '../../stores/backgrounds';
import { WeatherCard } from './WeatherCard';
import { PlaceHeader, PhotoWallBlock, VisitLogSection, WriteNoteBar } from '../shared/PlaceBlocks';
import { useBottomSheet } from '../shared/useBottomSheet';

export function DistrictDrawer() {
  const open = useUi((s) => s.drawerOpen);
  const panelFullscreen = useUi((s) => s.panelFullscreen);
  const togglePanelFullscreen = useUi((s) => s.togglePanelFullscreen);
  const sheet = useBottomSheet(open, panelFullscreen);
  const favorites = useUi((s) => s.favorites);
  const toggleFavorite = useUi((s) => s.toggleFavorite);
  const openLeaf = useUi((s) => s.openLeaf);
  const activeDistrictId = useNavigation((s) => s.activeDistrictId);
  const districts = useData((s) => s.districts);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);
  const visitedDistricts = useCityStatus((s) => s.visitedDistricts);
  const toggleVisitedDistrict = useCityStatus((s) => s.toggleVisitedDistrict);
  const district = activeDistrictId ? districts[activeDistrictId] : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeDistrictId]);

  const allSpots = district ? (spotsByDistrict[district.id] ?? []) : [];
  const districtFoods = district?.foods ?? [];
  const specialties = district?.specialties ?? [];
  // 必须浅拷贝后再排：allSpots 就是 store 里的数组本身，就地 sort 会绕开 set() 改写状态，
  // DataPanel 的 dirty 比较会把「只是排了个序」误判成有未保存改动。
  const spots = [...allSpots].sort((a, b) => Number(Boolean(b.hot)) - Number(Boolean(a.hot)));
  const favored = district ? favorites.districts.includes(district.id) : false;
  const visitedDistrict = district ? visitedDistricts.includes(district.id) : false;

  return (
    <aside
      className={`drawer${open && district ? ' is-open' : ''}${panelFullscreen ? ' is-full' : ''}`}
      aria-hidden={!open}
      style={sheet.rootStyle}
    >
      {district && (
        <div className="drawer-inner">
          <div className="sheet-grabber" {...sheet.bind} aria-hidden="true" />
          <PlaceHeader
            kicker={`${district.province} · ${district.city}`}
            name={district.name}
            favored={favored}
            visited={visitedDistrict}
            onToggleFav={() => toggleFavorite('district', district.id)}
            onToggleVisited={() => toggleVisitedDistrict(district.id)}
            onClose={() => {
              clearDistrictSelection();
              togglePanelFullscreen(false);
            }}
            favTitleOff="收藏该区县"
            favTitleOn="取消收藏该区县"
            closeTitle="关闭"
          />

          <div className="drawer-scroll" ref={scrollRef} key={district.id}>
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

            <WeatherCard id={district.id} center={district.center} />

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

            <PhotoWallBlock scope="district" id={district.id} title={district.name} />

            <VisitLogSection
              kind="district"
              placeId={district.id}
              emptyHint="还没有游玩记录。点右上角「去过」会自动记一次；也可以手动补充具体的游玩日期，支持起止范围。"
            />

            <footer className="drawer-source">
              <span>更新于 {district.updatedAt}</span>
            </footer>
          </div>

          {/* 写游记：与城市概览同一位置（滚动区之外，常驻底部） */}
          <WriteNoteBar kind="district" id={district.id} name={district.name} />
        </div>
      )}
    </aside>
  );
}
