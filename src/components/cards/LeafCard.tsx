import type { CSSProperties } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { clearSpotFocus, focusSpotById, selectDistrictById } from '../../app/sandbox';
import { TAG_COLOR, thumbColor } from '../shared/meta';
import { BgImage } from '../shared/BgImage';
import { bgKey } from '../../stores/backgrounds';

export function LeafCard() {
  const leaf = useUi((s) => s.leafCard);
  const favorites = useUi((s) => s.favorites);
  const toggleFavorite = useUi((s) => s.toggleFavorite);
  const openLeaf = useUi((s) => s.openLeaf);
  const districts = useData((s) => s.districts);
  const spots = useData((s) => s.spots);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);

  if (!leaf) return null;

  const close = () => {
    openLeaf(null);
    if (leaf.kind === 'spot') clearSpotFocus();
  };

  if (leaf.kind === 'spot') {
    const spot = spots[leaf.id];
    if (!spot) return null;
    const district = districts[spot.districtId];
    const favored = favorites.spots.includes(spot.id);
    const siblings = (spotsByDistrict[spot.districtId] ?? [])
      .filter((s) => s.id !== spot.id)
      .sort((a, b) => Number(Boolean(b.hot)) - Number(Boolean(a.hot)))
      .slice(0, 3);

    return (
      <div className="leaf-backdrop" onPointerDown={close}>
        <article className="leaf-card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="leaf-hero leaf-hero--img">
            <BgImage
              bgKey={bgKey('spot', spot.id)}
              src={spot.image ?? `/assets/spots/${spot.id}.jpg`}
              alt={spot.name}
              label={spot.name}
              tags={spot.tags}
              className="leaf-hero-img"
              editable
            />
            <div className="leaf-hero-grad" />
            <div className="leaf-hero-top">
              <span className="leaf-type">景点</span>
              {spot.hot && <span className="leaf-hot">热门</span>}
            </div>
            <button className="leaf-close" onClick={close} aria-label="关闭">
              ×
            </button>
          </div>

          <div className="leaf-body">
            <h2 className="leaf-title">{spot.name}</h2>
            <p className="leaf-sub">
              {district?.province} · {district?.city} · {district?.name}
            </p>

            <div className="tag-row">
              {spot.tags.map((tag) => (
                <span
                  key={tag}
                  className="chip"
                  style={{ '--tag-color': TAG_COLOR[tag] } as CSSProperties}
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="leaf-summary">{spot.summary}</p>

            <dl className="leaf-meta">
              <div>
                <dt>适合人群</dt>
                <dd>{spot.suitableFor?.join(' · ') ?? '不限'}</dd>
              </div>
              <div>
                <dt>建议时长</dt>
                <dd>{spot.duration ?? '—'}</dd>
              </div>
              <div>
                <dt>所属区县</dt>
                <dd>
                  {district ? (
                    <button
                      className="link-btn"
                      onClick={() => {
                        openLeaf(null);
                        if (district) void selectDistrictById(district.id);
                      }}
                    >
                      {district.name}
                    </button>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>

            {siblings.length > 0 && (
              <div className="leaf-related">
                <div className="leaf-related-head">同区县还有</div>
                <div className="leaf-related-list">
                  {siblings.map((s) => (
                    <button
                      key={s.id}
                      className="leaf-related-item"
                      onClick={() => void focusSpotById(s.id)}
                    >
                      <span
                        className="leaf-related-dot"
                        style={{ backgroundColor: thumbColor(s.tags) }}
                      />
                      <span className="leaf-related-name">{s.name}</span>
                      <span className="leaf-related-tag">{s.tags[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="leaf-actions">
              <button
                className={`primary-btn${favored ? ' is-on' : ''}`}
                onClick={() => toggleFavorite('spot', spot.id)}
              >
                {favored ? '★ 已收藏' : '☆ 收藏'}
              </button>
              <button
                className="ghost-btn"
                onClick={() => {
                  openLeaf(null);
                  void focusSpotById(spot.id);
                }}
              >
                在地图上定位
              </button>
            </div>
          </div>
        </article>
      </div>
    );
  }

  const district = districts[leaf.districtId];
  const food = district?.foods?.find((f) => f.name === leaf.name);
  if (!district || !food) return null;
  const otherFoods = (district.foods ?? []).filter((f) => f.name !== food.name).slice(0, 3);

  return (
    <div className="leaf-backdrop" onPointerDown={close}>
      <article className="leaf-card leaf-card--food" onPointerDown={(e) => e.stopPropagation()}>
        <div className="leaf-hero leaf-hero--img">
          <BgImage
            bgKey={bgKey('food', 'district', district.id, food.name)}
            src={food.image}
            alt={food.name}
            label={food.name}
            className="leaf-hero-img"
            editable
          />
          <div className="leaf-hero-grad" />
          <div className="leaf-hero-top">
            <span className="leaf-type leaf-type--food">美食</span>
          </div>
          <button className="leaf-close" onClick={close} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="leaf-body">
          <h2 className="leaf-title">{food.name}</h2>
          <p className="leaf-sub">
            {district.city} · {district.name} · {food.category}
          </p>
          <p className="leaf-summary">{food.note}</p>
          <dl className="leaf-meta">
            <div>
              <dt>品类</dt>
              <dd>{food.category}</dd>
            </div>
            <div>
              <dt>推荐区域</dt>
              <dd>{food.recommend}</dd>
            </div>
            <div>
              <dt>所属区县</dt>
              <dd>
                <button
                  className="link-btn"
                  onClick={() => {
                    openLeaf(null);
                    void selectDistrictById(district.id);
                  }}
                >
                  {district.name}
                </button>
              </dd>
            </div>
          </dl>

          {otherFoods.length > 0 && (
            <div className="leaf-related">
              <div className="leaf-related-head">同区县还有</div>
              <div className="leaf-related-list">
                {otherFoods.map((f) => (
                  <button
                    key={f.name}
                    className="leaf-related-item"
                    onClick={() => openLeaf({ kind: 'food', districtId: district.id, name: f.name })}
                  >
                    <span className="leaf-related-dot leaf-related-dot--food" />
                    <span className="leaf-related-name">{f.name}</span>
                    <span className="leaf-related-tag">{f.category}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
