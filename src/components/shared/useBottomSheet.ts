import { useEffect, useRef, useState } from 'react';

/**
 * 手机端「底部半屏面板」的下滑手势
 * ---------------------------------
 * 区县详情 / 城市概览在手机上都是贴底半屏（52vh）。桌面端点 × 关闭会回到全局地图，
 * 用户想要「滑下去看看完整的地图」又不想关掉这层（关了视角就回全局了）。
 * 这个 hook 给半屏面板一个简单的 bottom-sheet 收起手势：
 *   - 顶部抓手可点按：展开 ↔ 收起（只留顶 ~18vh，露出背后整张地图）
 *   - 抓手上拖 / 下拖：实时跟手，松手按阈值吸附到「展开」或「收起」
 * 收起态不触发任何关闭动作，所以地图保持当前聚焦，不会回全局。
 * 全屏（is-full）或面板关闭（open=false）时不生效。
 */

type Sheet = 'open' | 'peek';

/** 收起后保留的可见高度占比（顶部这段仍显示标题栏 + 抓手） */
const PEEK_VISIBLE = 0.18;
/** 半屏面板高度占比（与 CSS 里 52vh 保持一致） */
const SHEET_HEIGHT = 0.52;

export function useBottomSheet(open: boolean, isFull: boolean) {
  const [sheet, setSheet] = useState<Sheet>('open');
  const [dragY, setDragY] = useState<number | null>(null);
  const [peekOffset, setPeekOffset] = useState(0);
  const startRef = useRef<{ y: number; base: number } | null>(null);
  const movedRef = useRef(0);
  /** 是否发生过真正的拖拽位移（> 8px）：用来区分「点按」与「拖拽」，避免触摸抖动误判 */
  const draggedRef = useRef(false);

  const computePeek = () => {
    if (typeof window === 'undefined') return 0;
    // 面板高 52vh，收起后留 18vh 可见 → 需要下滑 (52-18)% 视口高
    return Math.round(window.innerHeight * (SHEET_HEIGHT - PEEK_VISIBLE));
  };

  useEffect(() => {
    setPeekOffset(computePeek());
    const onResize = () => setPeekOffset(computePeek());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 进入全屏或关闭时，复位到展开，避免下次打开还停在收起态
  useEffect(() => {
    if (isFull || !open) setSheet('open');
  }, [isFull, open]);

  const restingY = sheet === 'peek' ? peekOffset : 0;

  const rootStyle: React.CSSProperties | undefined = !open || isFull
    ? undefined
    : {
        transform: `translateY(${(dragY ?? restingY)}px)`,
        transition: dragY !== null ? 'none' : 'transform 0.28s cubic-bezier(0.22,0.8,0.28,1)',
      };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!open || isFull) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startRef.current = { y: e.clientY, base: dragY ?? restingY };
    movedRef.current = 0;
    draggedRef.current = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = startRef.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    movedRef.current = Math.max(movedRef.current, Math.abs(dy));
    if (Math.abs(dy) > 8) draggedRef.current = true;
    // 下滑夹紧到 peekOffset（最多再溢出一点），上滑最多回到 0（完全展开）
    const next = Math.max(0, Math.min(s.base + dy, peekOffset + 60));
    setDragY(next);
  };

  const onPointerUp = () => {
    const s = startRef.current;
    startRef.current = null;
    if (!s) return;
    const finalY = dragY ?? s.base;
    setDragY(null);
    // 没发生过真正的拖拽位移 = 点按：展开 / 收起切换
    if (!draggedRef.current) {
      setSheet((p) => (p === 'peek' ? 'open' : 'peek'));
      return;
    }
    if (sheet === 'peek') {
      setSheet(finalY < peekOffset * 0.6 ? 'open' : 'peek');
    } else {
      setSheet(finalY > peekOffset * 0.5 ? 'peek' : 'open');
    }
  };

  const bind = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  return { sheet, rootStyle, bind, peekOffset };
}
