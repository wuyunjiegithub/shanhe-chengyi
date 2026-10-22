import { useEffect, useMemo, useState } from 'react';
import { useCityStatus } from '../../stores/cityStatus';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { useVisitLog } from '../../stores/visitLog';
import type { VisitKind } from '../../stores/visitLog';
import { focusCityById, selectDistrictById } from '../../app/sandbox';
import { VisitedMark } from '../shared/VisitedMark';

function fmtDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface PlaceGroup {
  kind: VisitKind;
  placeId: string;
  name: string;
  sub: string;
  count: number;
  lastAt: number;
  marked: boolean;
}

export function TimelinePanel() {
  const open = useUi((s) => s.timelineOpen);
  const close = useUi((s) => s.toggleTimelinePanel);
  const records = useVisitLog((s) => s.records);
  const removeRecord = useVisitLog((s) => s.removeRecord);
  const clearVisits = useVisitLog((s) => s.clearVisits);
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const districtNames = useData((s) => s.districtNames);
  const cityVisited = useCityStatus((s) => s.visited);
  const visitedDistricts = useCityStatus((s) => s.visitedDistricts);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const placeName = (kind: VisitKind, id: string): { name: string; sub: string } => {
    if (kind === 'city') {
      const city = cities.find((c) => c.id === id);
      return { name: city?.name ?? id, sub: city ? `${city.province} · 城市` : '城市' };
    }
    const d = districts[id];
    return {
      name: d?.name ?? districtNames[id] ?? id,
      sub: d ? `${d.city} · 区县` : '区县',
    };
  };

  /** 按地点聚合：去过几次、最近一次 */
  const groups: PlaceGroup[] = useMemo(() => {
    const map = new Map<string, PlaceGroup>();
    for (const r of records) {
      const key = `${r.kind}:${r.placeId}`;
      const g = map.get(key);
      const { name, sub } = placeName(r.kind, r.placeId);
      const marked =
        r.kind === 'city' ? cityVisited.includes(r.placeId) : visitedDistricts.includes(r.placeId);
      if (g) {
        g.count += 1;
        g.lastAt = Math.max(g.lastAt, r.at);
        g.marked = g.marked || marked;
      } else {
        map.set(key, { kind: r.kind, placeId: r.placeId, name, sub, count: 1, lastAt: r.at, marked });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, cities, districts, districtNames, cityVisited, visitedDistricts]);

  /** 时间倒序的逐次记录 */
  const chronological = useMemo(() => [...records].sort((a, b) => b.at - a.at), [records]);

  const cityCount = groups.filter((g) => g.kind === 'city').length;
  const districtCount = groups.filter((g) => g.kind === 'district').length;

  if (!open) return null;

  const onGo = (g: PlaceGroup) => {
    close(false);
    if (g.kind === 'city') void focusCityById(g.placeId);
    else void selectDistrictById(g.placeId);
  };

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <section className="fav-panel timeline-panel" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fav-head">
          <div>
            <div className="drawer-kicker">到访记录</div>
            <div className="fav-title-line">
              <h2 className="drawer-title">时间线</h2>
              <span className="fav-total">{records.length} 次</span>
            </div>
          </div>
          <button className="icon-btn" onClick={() => close(false)} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="fav-body">
          <div className="timeline-stats">
            <span>
              去过 <b>{cityCount}</b> 座城市
            </span>
            <i />
            <span>
              <b>{districtCount}</b> 个区县
            </span>
            <i />
            <span>
              共 <b>{records.length}</b> 次足迹
            </span>
          </div>

          {records.length === 0 ? (
            <p className="block-empty">
              还没有到访记录。在城市面板或区县抽屉点「去过」，这里就会按时间记下一笔；
              具体的游玩日期可在那里手动补充。
            </p>
          ) : (
            <>
              <div className="fav-section">
                <h3 className="block-title">
                  <i />
                  去过的地方
                  <span className="block-count">{groups.length}</span>
                </h3>
                <ul className="fav-list">
                  {groups.map((g) => (
                    <li key={`${g.kind}-${g.placeId}`}>
                      <button className="fav-item" onClick={() => onGo(g)}>
                        <span className="fav-item-mark">
                          <VisitedMark on />
                        </span>
                        <span className="fav-item-body">
                          <span className="fav-item-name">{g.name}</span>
                          <span className="fav-item-sub">
                            {g.sub} · 去过 {g.count} 次 · 最近 {fmtDate(g.lastAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="fav-section">
                <h3 className="block-title">
                  <i />
                  时间线
                  <span className="block-count">{chronological.length}</span>
                </h3>
                <ol className="timeline-track">
                  {chronological.map((r) => {
                    const { name, sub } = placeName(r.kind, r.placeId);
                    return (
                      <li key={r.id} className="timeline-record">
                        <span className="timeline-record-dot" />
                        <div className="timeline-record-body">
                          <div className="timeline-record-date">
                            {fmtDate(r.at)}
                            <span className="timeline-record-time">{fmtTime(r.at)}</span>
                            <span className={`timeline-kind timeline-kind--${r.kind}`}>
                              {r.kind === 'city' ? '城市' : '区县'}
                            </span>
                          </div>
                          <div className="timeline-record-name">
                            {name}
                            <span className="timeline-record-sub">{sub}</span>
                          </div>
                        </div>
                        <button
                          className="fav-remove"
                          onClick={() => removeRecord(r.id)}
                          title="删除这条记录"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          )}
        </div>

        <footer className="fav-foot">
          <div className="fav-foot-actions">
            <button
              className={`ghost-btn${confirmClear ? ' is-danger' : ''}`}
              disabled={records.length === 0}
              onClick={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                clearVisits();
                setConfirmClear(false);
              }}
            >
              {confirmClear ? '确认清空时间线？' : '清空时间线'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
