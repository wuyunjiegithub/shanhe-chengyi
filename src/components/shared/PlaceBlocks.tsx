import { useState } from 'react';
import { useUi } from '../../stores/ui';
import { useVisitLog } from '../../stores/visitLog';
import type { VisitKind } from '../../stores/visitLog';
import { HeartMark } from './HeartMark';
import { VisitedMark } from './VisitedMark';
import { PanelFullscreenBtn } from './PanelFullscreenBtn';

/**
 * 城市概览 / 区县详情的「公共零件」
 * --------------------------------
 * 两个面板原本各写了一份几乎一样的收藏 / 去过、照片墙、游玩日期、写游记，
 * 结果格式越改越不一样（收藏一个在右上角、一个在底部）。现在统一放这里：
 * 谁都用同一份，格式就不会再跑偏。
 */

export function fmtVisitDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 右上角「收藏 / 去过」图标按钮组（与关闭叉号同一排） */
export function PlaceStatusActions({
  favored,
  visited,
  onToggleFav,
  onToggleVisited,
  favTitleOn = '取消收藏',
  favTitleOff = '收藏',
  visitedTitleOn = '取消「去过」标记',
  visitedTitleOff = '标记去过（插小红旗）',
}: {
  favored: boolean;
  visited: boolean;
  onToggleFav: () => void;
  onToggleVisited: () => void;
  favTitleOn?: string;
  favTitleOff?: string;
  visitedTitleOn?: string;
  visitedTitleOff?: string;
}) {
  return (
    <>
      <button
        className={`icon-btn icon-btn--fav${favored ? ' is-on' : ''}`}
        title={favored ? favTitleOn : favTitleOff}
        onClick={onToggleFav}
      >
        <HeartMark on={favored} />
      </button>
      <button
        className={`icon-btn icon-btn--visited${visited ? ' is-on' : ''}`}
        title={visited ? visitedTitleOn : visitedTitleOff}
        onClick={onToggleVisited}
      >
        <VisitedMark on={visited} />
      </button>
    </>
  );
}

/** 封面右上角那一排：全屏钮 + 收藏 + 去过（城市概览没有标题栏，只能浮在封面上） */
export function PlaceHeadActions(props: Parameters<typeof PlaceStatusActions>[0]) {
  return (
    <div className="place-head-actions">
      <PanelFullscreenBtn />
      <PlaceStatusActions {...props} />
    </div>
  );
}

/** 照片墙入口区块 */
export function PhotoWallBlock({
  scope,
  id,
  title,
}: {
  scope: 'city' | 'district';
  id: string;
  title: string;
}) {
  const openPhotoWall = useUi((s) => s.openPhotoWall);
  return (
    <section className="content-block">
      <h3 className="block-title">
        <i />照片墙
      </h3>
      <button
        className="photo-wall-trigger"
        onClick={() => openPhotoWall({ scope, id, title: `${title} · 照片墙` })}
      >
        <span className="photo-wall-trigger-ico">▦</span>
        打开 {title} 照片墙
      </button>
    </section>
  );
}

/** 游玩日期区块（含手动补充起止范围） */
export function VisitLogSection({
  kind,
  placeId,
  emptyHint,
}: {
  kind: VisitKind;
  placeId: string;
  emptyHint: string;
}) {
  const visitRecords = useVisitLog((s) => s.records);
  const logVisitAt = useVisitLog((s) => s.logVisitAt);
  const removeRecord = useVisitLog((s) => s.removeRecord);
  const [visitDate, setVisitDate] = useState('');
  const [visitEnd, setVisitEnd] = useState('');

  const visits = visitRecords
    .filter((r) => r.kind === kind && r.placeId === placeId)
    .sort((a, b) => b.at - a.at);

  return (
    <section className="content-block">
      <h3 className="block-title">
        <i />游玩日期
        <span className="block-count">{visits.length}</span>
      </h3>
      {visits.length === 0 ? (
        <p className="block-empty">{emptyHint}</p>
      ) : (
        <ul className="visit-list">
          {visits.map((r) => (
            <li key={r.id} className="visit-row">
              <span className="visit-date">
                {fmtVisitDate(r.at)}
                {r.endAt ? ` – ${fmtVisitDate(r.endAt)}` : ''}
              </span>
              <button className="visit-del" title="删除这条游玩记录" onClick={() => removeRecord(r.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="visit-add">
        <div className="visit-range">
          <input
            type="date"
            className="visit-date-input"
            value={visitDate}
            max={visitEnd || new Date().toISOString().slice(0, 10)}
            onChange={(e) => setVisitDate(e.target.value)}
            placeholder="起始日期"
          />
          <span className="visit-range-sep">至</span>
          <input
            type="date"
            className="visit-date-input"
            value={visitEnd}
            min={visitDate || undefined}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setVisitEnd(e.target.value)}
            placeholder="结束日期（可选）"
          />
        </div>
        <button
          className="ghost-btn"
          disabled={!visitDate}
          onClick={() => {
            if (!visitDate) return;
            const t = new Date(`${visitDate}T12:00:00`).getTime();
            const end = visitEnd ? new Date(`${visitEnd}T12:00:00`).getTime() : undefined;
            logVisitAt(kind, placeId, t, end && end >= t ? end : undefined);
            setVisitDate('');
            setVisitEnd('');
          }}
        >
          添加这次游玩
        </button>
      </div>
    </section>
  );
}

/**
 * 面板底部的「写游记」条：城市与区县同一条、同一位置（滚动区之外，常驻可见）。
 * 收藏 / 去过已统一放到右上角，这里只留写游记这一个主动作。
 */
export function WriteNoteBar({ kind, id, name }: { kind: VisitKind; id: string; name: string }) {
  const openTravelWithPlace = useUi((s) => s.openTravelWithPlace);
  return (
    <div className="place-actions">
      <button
        className="place-act place-act--note"
        onClick={() => openTravelWithPlace({ kind, id, name })}
        title={`写一篇关于${name}的游记`}
      >
        ✎ 写游记
      </button>
    </div>
  );
}
