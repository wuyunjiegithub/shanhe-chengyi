import { useUi } from '../../stores/ui';

/**
 * 移动端面板「全屏 / 退出全屏」切换钮（城市概览 + 区县详情共用）。
 *
 * 手机上详情一全屏就把地图盖住了，没法接着点别的区县，所以默认半屏：
 * 上半屏留地图，下半屏看详情。想沉浸式看内容再点这个钮全屏，看完退出即可。
 * 桌面端是右侧栏，不存在这个问题，CSS 里直接隐藏。
 */
export function PanelFullscreenBtn() {
  const full = useUi((s) => s.panelFullscreen);
  const toggle = useUi((s) => s.togglePanelFullscreen);

  return (
    <button
      className="icon-btn panel-fs-btn"
      type="button"
      title={full ? '退出全屏（露出地图继续选区县）' : '全屏查看'}
      aria-label={full ? '退出全屏' : '全屏'}
      onClick={() => toggle()}
    >
      {full ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </svg>
      )}
    </button>
  );
}
