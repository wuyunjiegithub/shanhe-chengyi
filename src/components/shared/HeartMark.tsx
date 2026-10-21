interface HeartMarkProps {
  on: boolean;
  size?: number;
}

/**
 * 「收藏」标记：爱心。
 * 未收藏为描边空心心；已收藏为实心粉心（#f472b6），
 * 与「去过」的小红旗在形状与色相上都明确区分，
 * 且 3D 场景里竖插的粉色爱心保持同一语义。
 *
 * 默认尺寸比 VisitedMark 小一档：心形几乎填满整个 viewBox，
 * 而红旗只有「一根杆 + 半张旗面」，同尺寸下视觉体量明显偏小，
 * 统一 15px 会被感知为「爱心太大、旗子太小」。
 */
export function HeartMark({ on, size = 14 }: HeartMarkProps) {
  return (
    <svg
      className={`heart-mark${on ? ' is-on' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        className="heart-mark__shape"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
