import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

export interface PhotoViewerProps {
  /** 已解析的媒体地址（img / video 通用）；null 时显示占位 */
  src: string | null;
  title: string;
  sub?: string;
  /** 文件修改时间（ms），有则显示日期 */
  time?: number;
  /** 「3 / 12」计数 */
  counter?: string;
  kind?: 'image' | 'video';
  /** 图注（用户给单张照片写的说明） */
  caption?: string;
  /** 图注变更回调（传空串表示删除） */
  onCaption?: (text: string) => void;
  /** 是否显示照片名（移动端套壳不显示） */
  showName?: boolean;
  /** 改名回调（桌面端提供；传空串表示恢复默认名） */
  onRename?: (text: string) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** 删除当前媒体（仅手动上传的条目传） */
  onDelete?: () => void;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;
/** 触屏滑动切图：位移超过这个比例（或最小像素）才算一次切图 */
const SWIPE_RATIO = 0.16;
const SWIPE_MIN_PX = 52;

/** 触屏设备：用横向滑动代替两侧箭头按钮 */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

function fmtTime(t?: number): string {
  if (!t) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/**
 * 照片查看器：放大 / 缩小 / 旋转 / 拖拽平移的基础看图工具。
 * - 按钮组：＋ － ↺ ↻ ⤾（复位） ×
 * - 滚轮缩放（以光标为中心）、双击在 1x ↔ 2.5x 间切换
 * - 单指 / 鼠标拖拽平移；双指捏合缩放
 * - 触屏上 1x 状态左右滑动 = 切上 / 下一张（此时两侧箭头按钮隐藏，避免误触与遮挡画面）
 * - Esc 关闭；左右方向键切换上 / 下一张
 */
export function PhotoViewer({
  src,
  title,
  sub,
  time,
  counter,
  kind = 'image',
  caption,
  onCaption,
  showName = true,
  onRename,
  onClose,
  onPrev,
  onNext,
  onDelete,
}: PhotoViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  /** 删除二次确认：第一下进入待确认态，第二下（4 秒内）才真删 */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 图注编辑态 */
  const [editingCap, setEditingCap] = useState(false);
  const [capDraft, setCapDraft] = useState('');
  /** 改名编辑态 */
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  /** 触屏：横向滑动切换（1x 时单指左右滑），滑动中图片跟手位移 */
  const coarse = useRef(isCoarsePointer()).current;
  const [swipeDx, setSwipeDx] = useState(0);
  const [swipeGlide, setSwipeGlide] = useState(false);

  // 换图（上/下一张）时复位变换与删除确认，避免沿用上一张的状态
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setSwipeDx(0);
    setSwipeGlide(false);
    setConfirmDelete(false);
    setEditingCap(false);
    setCapDraft('');
    setEditingName(false);
    setNameDraft('');
  }, [src]);

  const startEditCap = () => {
    setCapDraft(caption ?? '');
    setEditingCap(true);
  };
  const saveCap = () => {
    onCaption?.(capDraft);
    setEditingCap(false);
  };

  const startEditName = () => {
    setNameDraft(title);
    setEditingName(true);
  };
  const saveName = () => {
    onRename?.(nameDraft.trim());
    setEditingName(false);
  };

  /** 删除按钮：两段式确认（删的是磁盘文件，不可恢复） */
  const onDeleteClick = () => {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      window.setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    onDelete();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && onPrev) {
        e.stopPropagation();
        onPrev();
      }
      if (e.key === 'ArrowRight' && onNext) {
        e.stopPropagation();
        onNext();
      }
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(MAX_SCALE, s * 1.25));
      if (e.key === '-') setScale((s) => Math.max(MIN_SCALE, s / 1.25));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onPrev, onNext]);

  // ---------- 指针：拖拽平移 + 双指捏合 + 触屏横滑切图 ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  /** 触屏横滑手势：locked 为 null = 方向未定，true = 正在切图，false = 判定为纵向、放弃 */
  const swipe = useRef<{ id: number; x: number; y: number; dx: number; locked: boolean | null } | null>(
    null,
  );
  const glideTimer = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (glideTimer.current) {
      window.clearTimeout(glideTimer.current);
      glideTimer.current = null;
    }
    setSwipeGlide(false);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag.current = null;
      // 双指 = 缩放，撤销可能已开始的切图手势
      swipe.current = null;
      setSwipeDx(0);
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY };
      // 触屏且未放大：单指左右滑 = 切上 / 下一张。
      // 视频要留出原生控件（进度条本身就是横向拖动），不接管。
      const canSwipe = coarse && scale <= 1.001 && kind !== 'video' && Boolean(onPrev || onNext);
      swipe.current = canSwipe
        ? { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, locked: null }
        : null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) {
        const next = (pinch.current.scale * dist) / pinch.current.dist;
        setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
      }
      return;
    }

    const sw = swipe.current;
    if (sw && sw.id === e.pointerId) {
      const dx = e.clientX - sw.x;
      const dy = e.clientY - sw.y;
      if (sw.locked === null) {
        // 先看方向：横向占优才接管，纵向手势直接放过（1x 下本来也不做事）
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) sw.locked = true;
        else if (Math.abs(dy) > 14) sw.locked = false;
      }
      if (sw.locked) {
        // 到头了（第一张还想往右 / 最后一张还想往左）加阻尼，给出「没有下一张」的手感
        const blocked = (dx > 0 && !onPrev) || (dx < 0 && !onNext);
        sw.dx = blocked ? dx * 0.3 : dx;
        setSwipeDx(sw.dx);
        return;
      }
      if (sw.locked === false) return;
    }

    // 单指拖拽：只在已放大（scale>1）时才平移查看；1x 时图片固定不动，
    // 按住拖动不会把图拖走（满足「不用拖动、固定住、放大后才能拖动查看」）。
    if (drag.current && scale > 1.001) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    const sw = swipe.current;
    if (sw && sw.id === e.pointerId) {
      const width = e.currentTarget.getBoundingClientRect().width || 360;
      const threshold = Math.max(SWIPE_MIN_PX, width * SWIPE_RATIO);
      const moved = sw.locked ? sw.dx : 0;
      swipe.current = null;
      // 松手：先回弹（带过渡），够阈值就切图
      setSwipeGlide(true);
      setSwipeDx(0);
      glideTimer.current = window.setTimeout(() => {
        glideTimer.current = null;
        setSwipeGlide(false);
      }, 260);
      if (Math.abs(moved) >= threshold) {
        if (moved < 0) onNext?.();
        else onPrev?.();
      }
    }

    if (pointers.current.size === 0) {
      drag.current = null;
    } else if (pointers.current.size === 1) {
      // 双指捏合结束、尚剩一指：把它当作新的拖拽起点，放大后可直接接单指平移
      const [p] = [...pointers.current.values()];
      drag.current = { x: p.x, y: p.y };
    }
  };

  useEffect(
    () => () => {
      if (glideTimer.current) window.clearTimeout(glideTimer.current);
    },
    [],
  );

  /** 滚轮缩放：以光标位置为锚点，缩放后补偿偏移，视觉上「对着光标的那一点放大」 */
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setScale((s) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (1 - e.deltaY * 0.0015)));
      const k = next / s;
      setOffset((o) => ({ x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k }));
      return next;
    });
  };

  const zoom = (factor: number) => setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  const reset = () => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };

  const mediaStyle: CSSProperties = {
    transform: `translate(${offset.x + swipeDx}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
    // 滑动结束回弹时给过渡；拖动中 / 缩放中不加，避免跟手迟滞
    transition: swipeGlide ? 'transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1)' : undefined,
  };

  return (
    <div className="pv-backdrop" onPointerDown={onClose}>
      <div className="pv-stage" onPointerDown={(e) => e.stopPropagation()}>
        <div
          className="pv-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          onDoubleClick={() => (scale > 1.05 ? reset() : setScale(2.5))}
        >
          {src ? (
            kind === 'video' ? (
              <video className="pv-media" style={mediaStyle} src={src} controls autoPlay loop muted playsInline />
            ) : (
              <img className="pv-media" style={mediaStyle} src={src} alt={title} draggable={false} />
            )
          ) : (
            <span className="pv-media-loading">载入中…</span>
          )}
        </div>

        <div className="pv-bar">
          <div className="pv-meta">
            {showName && (
              <>
                <b>{title}</b>
                {sub && <i>{sub}</i>}
              </>
            )}
            {time ? <i>{fmtTime(time)}</i> : null}
            {counter && <span>{counter}</span>}
          </div>
          <div className="pv-tools">
            {onDelete && (
              <button
                className={`pv-del${confirmDelete ? ' is-armed' : ''}`}
                onClick={onDeleteClick}
                title={confirmDelete ? '再点一次确认删除（磁盘文件，不可恢复）' : '删除这个照片文件'}
                aria-label="删除"
              >
                {confirmDelete ? '确认删除？' : '🗑'}
              </button>
            )}
            <button onClick={() => zoom(1.25)} title="放大（＋）" aria-label="放大">
              ＋
            </button>
            <button onClick={() => zoom(0.8)} title="缩小（－）" aria-label="缩小">
              －
            </button>
            <button onClick={() => setRotation((r) => (r + 270) % 360)} title="向左旋转 90°" aria-label="左转">
              ↺
            </button>
            <button onClick={() => setRotation((r) => (r + 90) % 360)} title="向右旋转 90°" aria-label="右转">
              ↻
            </button>
            <button onClick={reset} title="复位（1:1）" aria-label="复位">
              ⤾
            </button>
            <span className="pv-scale">{Math.round(scale * 100)}%</span>
          </div>
        </div>

        {((showName && onRename) || onCaption) && (
          <div className="pv-caption">
          {showName && onRename && (
            editingName ? (
              <div className="pv-cap-edit">
                <input
                  className="pv-cap-input pv-rename-input"
                  value={nameDraft}
                  placeholder="给这张照片起个名字（留空恢复原名）"
                  maxLength={60}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                />
                <div className="pv-cap-actions">
                  <button type="button" className="ghost-btn" onClick={saveName}>
                    保存
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      onRename('');
                      setEditingName(false);
                    }}
                  >
                    恢复原名
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => setEditingName(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="pv-cap-line" onClick={startEditName}>
                <span className="pv-cap-placeholder">✎ 改名</span>
              </button>
            )
          )}
          {editingCap ? (
            <div className="pv-cap-edit">
              <textarea
                className="pv-cap-input"
                value={capDraft}
                placeholder="写一句图注，记录这张照片的故事…"
                maxLength={140}
                onChange={(e) => setCapDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveCap();
                }}
              />
              <div className="pv-cap-actions">
                <button type="button" className="ghost-btn" onClick={saveCap}>
                  保存
                </button>
                {caption && (
                  <button
                    type="button"
                    className="ghost-btn is-danger"
                    onClick={() => {
                      onCaption?.('');
                      setEditingCap(false);
                    }}
                  >
                    删除
                  </button>
                )}
                <button type="button" className="ghost-btn" onClick={() => setEditingCap(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="pv-cap-line" onClick={startEditCap}>
              {caption ? (
                <span className="pv-cap-text">{caption}</span>
              ) : (
                <span className="pv-cap-placeholder">✎ 添加图注</span>
              )}
            </button>
          )}
          </div>
        )}

        {/* 触屏上照片靠左右滑动切换，箭头会挡住画面；视频有原生控件、不接管手势，仍留箭头 */}
        {onPrev && (!coarse || kind === 'video') && (
          <button className="pv-nav pv-nav--prev" onClick={onPrev} aria-label="上一张">
            ‹
          </button>
        )}
        {onNext && (!coarse || kind === 'video') && (
          <button className="pv-nav pv-nav--next" onClick={onNext} aria-label="下一张">
            ›
          </button>
        )}
        <button className="pv-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
    </div>
  );
}
