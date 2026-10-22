import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { backToRegion, focusCityById, selectDistrictById } from '../../app/sandbox';
import type { Province } from '../../data/types';

const PROVINCE_ORDER: Province[] = ['上海市', '江苏省', '浙江省', '安徽省'];
const PROVINCE_CLASS: Record<Province, string> = {
  上海市: 'prov-sh',
  江苏省: 'prov-js',
  浙江省: 'prov-zj',
  安徽省: 'prov-ah',
};

export function LeftIndex() {
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);
  const districtNames = useData((s) => s.districtNames);
  const level = useNavigation((s) => s.level);
  const currentCity = useNavigation((s) => s.currentCity);
  const activeDistrictId = useNavigation((s) => s.activeDistrictId);
  const hovered = useNavigation((s) => s.hovered);
  const showToast = useUi((s) => s.showToast);

  if (level === 'city' && currentCity) {
    const indexedDistricts = currentCity.districts.filter((id) => districts[id]);
    const featured = (currentCity.featuredDistricts ?? [])
      .filter((id) => districts[id])
      .slice(0, 3);
    const citySpotCount = currentCity.districts.reduce(
      (sum, id) => sum + (spotsByDistrict[id]?.length ?? 0),
      0,
    );
    return (
      <aside className="hud left-index">
        <div className="index-head">
          <button className="index-back" onClick={backToRegion}>
            ← 江浙沪皖
          </button>
          <span className="index-count">{currentCity.districts.length} 区县</span>
        </div>
        <div className="index-city">{currentCity.name}</div>

        <div className="city-brief">
          <p className="city-brief-intro">
            {currentCity.intro || '按区县逐级浏览历史、人文与可玩地点。'}
          </p>
          <div className="city-brief-stats">
            <span>
              <b>{indexedDistricts.length}</b>/{currentCity.districts.length} 区县已录入
            </span>
            <span>
              <b>{citySpotCount}</b> 触点
            </span>
          </div>
          {featured.length > 0 && (
            <div className="city-brief-hot">
              <span className="city-brief-label">热门区县</span>
              {featured.map((id) => (
                <button
                  key={id}
                  className="city-hot-chip"
                  onClick={() => void selectDistrictById(id)}
                >
                  {districts[id].name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="index-scroll">
          {currentCity.districts.map((id) => {
            const district = districts[id];
            const name = district?.name ?? districtNames[id] ?? id;
            const spotCount = spotsByDistrict[id]?.length ?? 0;
            const isActive = activeDistrictId === id;
            const isHover = hovered?.id === id;
            return (
              <button
                key={id}
                className={`index-row index-row--district${isActive ? ' is-active' : ''}${
                  isHover ? ' is-hover' : ''
                }${district ? '' : ' is-empty'}`}
                onClick={() => {
                  if (district) void selectDistrictById(id);
                  else showToast(`${name} · 内容尚未录入`);
                }}
              >
                <span className="index-name">{name}</span>
                <span className="index-meta">{district ? `${spotCount} 景点` : '未录入'}</span>
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="hud left-index">
      <div className="index-head">
        <span className="index-title">区域索引 // {cities.length} 市</span>
        <span className="index-count">江浙沪皖</span>
      </div>
      <div className="index-scroll">
        {PROVINCE_ORDER.map((province) => {
          const list = cities.filter((c) => c.province === province);
          if (!list.length) return null;
          return (
            <div className="index-group" key={province}>
              <div className={`index-group-title ${PROVINCE_CLASS[province]}`}>
                <span>{province}</span>
                <span className="index-group-count">{list.length} 市</span>
              </div>
              {list.map((city) => {
                const isHover = hovered?.id === city.id;
                return (
                  <button
                    key={city.id}
                    className={`index-row${isHover ? ' is-hover' : ''}${city.indexed ? '' : ' is-empty'}`}
                    onClick={() => void focusCityById(city.id)}
                  >
                    <span className="index-name">{city.name}</span>
                    <span className="index-meta">
                      {city.indexed ? `${city.districts.length} 区县` : '待录入'}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
