import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { usePhotoLib } from '../../stores/photoLib';
import { SearchConsole } from './SearchConsole';
import { goToOverview } from '../../app/sandbox';

export function TopBar({ ready }: { ready: boolean }) {
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const level = useNavigation((s) => s.level);
  const currentCity = useNavigation((s) => s.currentCity);
  const editedCount = useData((s) => s.editedDistrictIds.length);
  const toggleDataPanel = useUi((s) => s.toggleDataPanel);
  const toggleSettings = useUi((s) => s.toggleSettings);
  const setDistrictPickerOpen = useUi((s) => s.setDistrictPickerOpen);
  const terrainOn = useUi((s) => s.terrain);
  const setTerrainOpen = useUi((s) => s.setTerrainOpen);
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
        {/* 移动端入口：桌面左侧常驻索引，这条按钮只在 ≤1080px 显示 */}
        <button
          type="button"
          className="data-pill idx-pick-btn"
          onClick={() => setDistrictPickerOpen(true)}
          title="选择城市 / 区县"
        >
          <span className="data-pill-icon">⌖</span>
          <span className="data-pill-label">区县</span>
        </button>
        {/* 地形开关放在顶栏：只藏在一级设置里没人找得到（手机端连设置入口都没有） */}
        <button
          type="button"
          className={`data-pill data-pill--terrain${terrainOn ? ' is-on' : ''}`}
          onClick={() => setTerrainOpen()}
          title={terrainOn ? '隐藏地形图层（山地 / 湖泊 / 江河）' : '显示地形图层'}
          aria-pressed={terrainOn}
        >
          <span className="data-pill-icon">⛰</span>
          <span className="data-pill-label">地形</span>
        </button>
        {/* 手机端不暴露设置：照片库绑定走系统相册自动匹配，留着只会误触 */}
        <button
          className="data-pill data-pill--photo top-only-desktop"
          onClick={() => toggleSettings(true)}
          title="设置：照片库绑定 / 实时更新"
        >
          <span className="data-pill-icon">⚙</span>
          <span className="data-pill-label">设置</span>
          {photoLive && <i className="data-pill-live" title="实时更新中" />}
          {photoTotal > 0 && <b>{photoTotal}</b>}
        </button>
        {/* 手机端底栏会被半屏详情盖住，重置视角改挂顶栏，任何时候都能一键回总览 */}
        <button
          type="button"
          className="data-pill top-reset-btn"
          onClick={goToOverview}
          title="重置视角"
          aria-label="重置视角"
        >
          <span className="data-pill-icon">⌂</span>
          <span className="data-pill-label">总览</span>
        </button>
        <button
          className="data-pill"
          onClick={() => toggleDataPanel(true)}
          title="编辑内容（本机保存）"
        >
          <span className="data-pill-icon">✎</span>
          <span className="data-pill-label">数据</span>
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
