import { useCityStatus } from '../../stores/cityStatus';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import { useTravelNotes } from '../../stores/travelNotes';
import { backToRegion, resetCamera } from '../../app/sandbox';
import { HeartMark } from '../shared/HeartMark';
import { VisitedMark } from '../shared/VisitedMark';

export function BottomBar() {
  const level = useNavigation((s) => s.level);
  const favorites = useUi((s) => s.favorites);
  const toggleFavoritesPanel = useUi((s) => s.toggleFavoritesPanel);
  const toggleTimelinePanel = useUi((s) => s.toggleTimelinePanel);
  const toggleTravelPanel = useUi((s) => s.toggleTravelPanel);
  const noteCount = useTravelNotes((s) => s.notes.length);
  const cityVisited = useCityStatus((s) => s.visited);
  const visitedDistricts = useCityStatus((s) => s.visitedDistricts);

  const favCount = favorites.districts.length + favorites.spots.length + favorites.cities.length;
  const trackCount = cityVisited.length + visitedDistricts.length + favCount;

  return (
    <footer className="hud hud-bottom">
      <div className="bottom-left">
        <button className="ghost-pill" onClick={resetCamera}>
          <span className="ghost-pill-icon">⌖</span>
          重置俯视 <b>50°</b>
        </button>
        <div className="legend">
          <span className="legend-item">
            <i className="legend-dot prov-sh" />
            上海
          </span>
          <span className="legend-item">
            <i className="legend-dot prov-js" />
            江苏
          </span>
          <span className="legend-item">
            <i className="legend-dot prov-zj" />
            浙江
          </span>
          <span className="legend-item">
            <i className="legend-dot prov-ah" />
            安徽
          </span>
          <span className="legend-item">
            <i className="legend-dot legend-dot--pin" />
            景点
          </span>
        </div>
      </div>

      <div className="bottom-right">
        <button
          className="ghost-pill fav-pill"
          onClick={() => toggleFavoritesPanel(true)}
          title="查看去过与收藏"
        >
          <span className="fav-pair">
            <HeartMark on size={12} />
            <VisitedMark on size={14} />
          </span>
          {trackCount > 0 ? `${trackCount} 条足迹` : '足迹收藏'}
        </button>
        <button
          className="ghost-pill"
          onClick={() => toggleTimelinePanel(true)}
          title="预览到访时间线（在区县详情里手动补录日期）"
        >
          <span className="fav-pair">
            <VisitedMark on size={13} />
          </span>
          时间线
        </button>
        <button
          className="ghost-pill"
          onClick={() => toggleTravelPanel(true)}
          title="预览我的游记（在区县详情里写）"
        >
          ✎ 游记{noteCount > 0 ? ` ${noteCount}` : ''}
        </button>
        {level === 'city' && (
          <button className="ghost-pill" onClick={backToRegion}>
            返回
          </button>
        )}
        <button className="compass" onClick={resetCamera} aria-label="重置视角">
          <span>N</span>
        </button>
      </div>
    </footer>
  );
}
