import { useEffect, useRef } from 'react';
import { useUi } from '../../stores/ui';
import { MARKER_H, MARKER_W, VISITED_STYLES, renderMarkerCanvas } from '../../scene/markerArt';
import type { VisitedStyle } from '../../scene/markerArt';

/**
 * 「去过」标记样式选择器（小旗子 / 图钉 / 打卡章 / 脚印）
 * -----------------------------------------------------
 * 原来只写在桌面设置面板里，而手机端顶栏为了腾地方把「设置」入口整颗藏了
 * （`.top-only-desktop`），结果手机用户根本没有地方改标记样式 —— 用户反馈
 * 「app 端看不见哪里可以设置去过的小旗子、图钉」。现在抽成公共组件：
 * 设置面板和「足迹与收藏」面板（手机底栏可直接进）都用同一份，改一处两边都变。
 */
export function MarkerStylePicker({
  compact = false,
  className = '',
}: {
  /** 紧凑版：一行四个小按钮，用于手机侧的面板 */
  compact?: boolean;
  className?: string;
}) {
  const visitedStyle = useUi((s) => s.visitedStyle);
  const setVisitedStyle = useUi((s) => s.setVisitedStyle);
  const current = VISITED_STYLES.find((x) => x.id === visitedStyle);

  return (
    <div className={`marker-style${compact ? ' marker-style--compact' : ''}${className ? ' ' + className : ''}`}>
      <div className="marker-style-head">
        <b>去过标记</b>
        <span className="marker-style-current">{current?.label ?? ''}</span>
      </div>
      <div className="marker-style-grid" role="radiogroup" aria-label="去过标记样式">
        {VISITED_STYLES.map((item) => {
          const active = item.id === visitedStyle;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`marker-style-opt${active ? ' is-on' : ''}`}
              title={item.note}
              onClick={() => setVisitedStyle(item.id)}
            >
              <MarkerPreview style={item.id} />
              <b>{item.label}</b>
            </button>
          );
        })}
      </div>
      <p className="marker-style-note">{current?.note}</p>
    </div>
  );
}

/**
 * 样式预览：用与地图标记完全相同的绘制函数画到 canvas 上，
 * 再靠 CSS 缩放成小图 —— 预览和实样永远不会走样。
 */
function MarkerPreview({ style }: { style: VisitedStyle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(renderMarkerCanvas('visited', style), 0, 0);
  }, [style]);
  return (
    <canvas
      ref={ref}
      className="marker-style-art"
      width={MARKER_W}
      height={MARKER_H}
      aria-hidden="true"
    />
  );
}
