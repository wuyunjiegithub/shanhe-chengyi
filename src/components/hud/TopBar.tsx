import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { SearchConsole } from './SearchConsole';

export function TopBar({ ready }: { ready: boolean }) {
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const level = useNavigation((s) => s.level);
  const currentCity = useNavigation((s) => s.currentCity);
  const editedCount = useData((s) => s.editedDistrictIds.length);
  const toggleDataPanel = useUi((s) => s.toggleDataPanel);
  const toggleSettings = useUi((s) => s.toggleSettings);
  const photoTotal = usePhotoLib((s) => s.index?.total ?? 0);
  const photoLive = usePhotoLib((s) => s.live);

  const districtCount = Object.keys(districts).length;
  const spotCount = useData((s) => Object.keys(s.spots).length);
  const indexedCities = cities.filter((c) => c.indexed).length;

  return (
    <header className="hud hud-top">
      <div className="brand-pill">
        <span className="brand-dot" />
        <span className="brand-name">山河城邑</span>
        <span className="brand-sep">/</span>
        <span className="brand-crumb">
          {level === 'city' && currentCity ? currentCity.name : '江浙沪皖'}
        </span>
        {level === 'city' && currentCity && <span className="brand-sub">{currentCity.province}</span>}
      </div>

      <SearchConsole />

      <div className="top-right">
        <button
          className="data-pill data-pill--photo"
          onClick={() => toggleSettings(true)}
          title="设置：照片库绑定 / 实时更新"
        >
          <span className="data-pill-icon">⚙</span>
          设置
          {photoLive && <i className="data-pill-live" title="实时更新中" />}
          {photoTotal > 0 && <b>{photoTotal}</b>}
        </button>
        <button
          className="data-pill"
          onClick={() => toggleDataPanel(true)}
          title="编辑本地内容（本机保存）"
        >
          <span className="data-pill-icon">✎</span>
          数据
          {editedCount > 0 && <b>{editedCount}</b>}
        </button>
        <div className="telemetry-pill">
          <span className="telemetry-strong" title={`${indexedCities} 个城市已录入内容，可下钻`}>
            {indexedCities}/{cities.length} 市 · {districtCount} 区县
          </span>
          <span className="telemetry-sep" />
          <span className="telemetry-muted">{spotCount} 触点</span>
          <span className="telemetry-sep" />
          <span className={`telemetry-state${ready ? ' is-ready' : ''}`}>
            <i />
            {ready ? '就绪' : '初始化…'}
          </span>
        </div>
      </div>
    </header>
  );
}
