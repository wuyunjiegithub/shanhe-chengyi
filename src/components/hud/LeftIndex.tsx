import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { backToRegion, focusCityById, selectDistrictById, isMunicipality } from '../../app/sandbox';
import type { GeoFeature } from '../../data/types';
import { provColor, provBg, NATIONAL_PROVINCE_ORDER } from '../../components/shared/meta';

export function LeftIndex() {
  const cities = useData((s) => s.cities);
  const cityGeo = useData((s) => s.cityGeo);
  const districts = useData((s) => s.districts);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);
  const districtNames = useData((s) => s.districtNames);
  const level = useNavigation((s) => s.level);
  const currentCity = useNavigation((s) => s.currentCity);
  const activeDistrictId = useNavigation((s) => s.activeDistrictId);
  const hovered = useNavigation((s) => s.hovered);
  const showToast = useUi((s) => s.showToast);

  if (level === 'city' && currentCity) {
    return (
      <aside className="hud left-index">
        <div className="index-head">
          <button
            className="index-back"
            onClick={() => backToRegion(isMunicipality(currentCity!.id) ? { toNation: true } : { toProvince: true })}
            title={isMunicipality(currentCity!.id) ? '退出城市，回到全国地图' : '退出城市，回到当前省份总览'}
          >
            {isMunicipality(currentCity!.id) ? '← 全国' : '← 当前省'}
          </button>
          <span className="index-count">{currentCity.districts.length} 区县</span>
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

  // 区域总览：列出全国所有城市（来自 cityGeo），按省份动态分组、动态配色
  const contentById = new Map(cities.map((c) => [c.id, c]));
  const byProvince = new Map<string, GeoFeature[]>();
  for (const g of cityGeo) {
    const p = g.province ?? '其他';
    if (!byProvince.has(p)) byProvince.set(p, []);
    byProvince.get(p)!.push(g);
  }
  const provinces = [...byProvince.keys()].sort((a, b) => {
    const ia = NATIONAL_PROVINCE_ORDER.indexOf(a);
    const ib = NATIONAL_PROVINCE_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  return (
    <aside className="hud left-index">
      <div className="index-head">
        <span className="index-title">区域索引 // {cityGeo.length} 市</span>
        <span className="index-count">全国</span>
      </div>
      <div className="index-scroll">
        {provinces.map((province) => {
          const list = byProvince.get(province)!;
          return (
            <div className="index-group" key={province}>
              <div
                className="index-group-title"
                style={{
                  color: provColor(province),
                  borderColor: provColor(province),
                  background: provBg(province),
                }}
              >
                <span>{province}</span>
                <span className="index-group-count">{list.length} 市</span>
              </div>
              {list.map((g) => {
                const cc = contentById.get(g.id);
                const indexed = cc?.indexed ?? g.indexed;
                const districtCount = cc?.districts.length ?? 0;
                const isHover = hovered?.id === g.id;
                return (
                  <button
                    key={g.id}
                    className={`index-row${isHover ? ' is-hover' : ''}${indexed ? '' : ' is-empty'}`}
                    onClick={() => void focusCityById(g.id)}
                  >
                    <span className="index-name">{g.name}</span>
                    <span className="index-meta">
                      {indexed ? `${districtCount} 区县` : '待录入'}
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
