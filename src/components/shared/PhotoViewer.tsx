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
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** 删除当前媒体（仅手动上传的条目传） */
  onDelete?: () => void;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;

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
 * - Esc 关闭；左右方向键切换上 / 下一张
 */
export function PhotoViewer({
  src,
  title,
  sub,
  time,
  counter,
  kind = 'image',
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

  // 换图（上/下一张）时复位变换与删除确认，避免沿用上一张的状态
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setConfirmDelete(false);
  }, [src]);

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

  // ---------- 指针：拖拽平移 + 双指捏合 ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY };
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
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

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
    transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
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
            <b>{title}</b>
            {sub && <i>{sub}</i>}
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

        {onPrev && (
          <button className="pv-nav pv-nav--prev" onClick={onPrev} aria-label="上一张">
            ‹
          </button>
        )}
        {onNext && (
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
