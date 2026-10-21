interface VisitedMarkProps {
  on: boolean;
  size?: number;
}

/**
 * 「去过」标记：飘扬的小红旗。
 * 未去过为描边空旗；已去过为实心红旗，
 * 与收藏的粉心在形状与色相上都明确区分，
 * 且与 3D 场景里插在板块上的小红旗同一语义。
 *
 * 默认尺寸比 HeartMark 大一档：红旗只占「一根杆 + 半张旗面」，
 * 同尺寸下视觉体量比填满 viewBox 的爱心小得多，需要补偿一档才等重。
 */
export function VisitedMark({ on, size = 17 }: VisitedMarkProps) {
  return (
    <svg
      className={`visited-mark${on ? ' is-on' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6.2 21.2V3.4"
        className="visited-mark__pole"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.2 4.2c2.5-1.4 4.9-1.4 7.2 0 2.3 1.4 4.6 1.4 7 0v7.4c-2.4 1.4-4.7 1.4-7 0-2.3-1.4-4.7-1.4-7.2 0z"
        className="visited-mark__flag"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
