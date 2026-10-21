import { useEffect, useMemo, useRef, useState } from 'react';
import type { District, Spot, Tag } from '../../data/types';
import { validateDraft } from '../../data/validate';
import type { Issue } from '../../data/validate';
import { useData } from '../../stores/data';
import { useNavigation } from '../../stores/navigation';
import { useUi } from '../../stores/ui';
import {
  cityIdOfDistrict,
  importContentBundleFile,
  refreshPins,
  updateMarkers,
} from '../../app/sandbox';
import { Field, FoodsEditor, PeopleEditor, SpecialtiesEditor, TagPicker } from './fields';

const EMPTY_SPOTS: Spot[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 保存 / 比较前统一清洗：去掉空行与空白项，spots 以景点列表为准 */
function normalizeDistrict(d: District, spots: Spot[]): District {
  return {
    ...d,
    oneLiner: d.oneLiner.trim(),
    features: (d.features ?? []).map((s) => s.trim()).filter(Boolean),
    people: (d.people ?? []).filter((p) => p.name.trim() || p.note.trim()),
    foods: (d.foods ?? []).filter((f) => f.name.trim() || f.category.trim() || f.recommend.trim() || f.note.trim()),
    specialties: (d.specialties ?? []).filter((s) => s.name.trim() || s.note.trim()),
    spots: spots.map((s) => s.id),
  };
}

function signature(d: District, spots: Spot[]): string {
  return JSON.stringify(normalizeDistrict(d, spots));
}

export function DataPanel() {
  const open = useUi((s) => s.dataPanelOpen);
  const close = useUi((s) => s.toggleDataPanel);
  const toast = useUi((s) => s.showToast);

  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const spotsByDistrict = useData((s) => s.spotsByDistrict);
  const spotCount = useData((s) => Object.keys(s.spots).length);
  const editedIds = useData((s) => s.editedDistrictIds);
  const activeDistrictId = useNavigation((s) => s.activeDistrictId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<District | null>(null);
  const [draftSpots, setDraftSpots] = useState<Spot[]>([]);
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ordered = useMemo(() => {
    const cityOrder = new Map(cities.map((c, i) => [c.id, i]));
    return Object.values(districts).sort((a, b) => {
      const ca = cityOrder.get(cityIdOfDistrict(a.id, a.province)) ?? 99;
      const cb = cityOrder.get(cityIdOfDistrict(b.id, b.province)) ?? 99;
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
  }, [cities, districts]);

  const groups = useMemo(() => {
    const map = new Map<string, District[]>();
    for (const d of ordered) {
      const list = map.get(d.city);
      if (list) list.push(d);
      else map.set(d.city, [d]);
    }
    return [...map.entries()];
  }, [ordered]);

  const keyword = query.trim();
  const filteredGroups = useMemo(() => {
    if (!keyword) return groups;
    return groups
      .map(([city, list]) => {
        const hit = list.filter(
          (d) => d.name.includes(keyword) || city.includes(keyword) || d.tags.some((t) => t.includes(keyword)),
        );
        return [city, hit] as [string, District[]];
      })
      .filter(([, list]) => list.length > 0);
  }, [groups, keyword]);

  const original = selectedId ? districts[selectedId] ?? null : null;
  const originalSpots = selectedId ? spotsByDistrict[selectedId] ?? EMPTY_SPOTS : EMPTY_SPOTS;

  const dirty = useMemo(() => {
    if (!draft || !original) return false;
    return signature(draft, draftSpots) !== signature(original, originalSpots);
  }, [draft, draftSpots, original, originalSpots]);

  const issues = useMemo<Issue[]>(() => {
    if (!draft) return [];
    return validateDraft({ ...draft, spots: draftSpots.map((s) => s.id) }, draftSpots);
  }, [draft, draftSpots]);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  const errorOf = (field: string) =>
    issues.find((i) => i.level === 'error' && i.field === field)?.message;
  const spotErrorOf = (spotId: string, field: string) => errorOf(`spot.${spotId}.${field}`);

  /* 打开面板时优先落到当前正在看的区县，否则落到第一个区县；数据重置 / 删除后自动修正选中项 */
  useEffect(() => {
    if (!open) return;
    if (selectedId && districts[selectedId]) return;
    const preferred =
      activeDistrictId && districts[activeDistrictId] ? districts[activeDistrictId] : ordered[0];
    if (!preferred) return;
    setSelectedId(preferred.id);
    setDraft(clone(preferred));
    setDraftSpots(clone(spotsByDistrict[preferred.id] ?? []));
  }, [open, selectedId, ordered, districts, spotsByDistrict, activeDistrictId]);

  useEffect(() => {
    if (!open) {
      setPendingId(null);
      setConfirmReset(false);
      setConfirmRemove(false);
      setSavedAt(null);
    }
  }, [open]);

  useEffect(() => {
    if (!confirmReset) return;
    const timer = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmReset]);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  if (!open) return null;

  function loadDraft(id: string) {
    const d = districts[id];
    if (!d) return;
    setSelectedId(id);
    setDraft(clone(d));
    setDraftSpots(clone(spotsByDistrict[id] ?? []));
    setPendingId(null);
    setConfirmRemove(false);
    setSavedAt(null);
  }

  function requestSelect(id: string) {
    if (id === selectedId) return;
    if (dirty) {
      setPendingId(id);
      return;
    }
    loadDraft(id);
  }

  const update = (patch: Partial<District>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateSpot = (id: string, patch: Partial<Spot>) =>
    setDraftSpots((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  function addSpot() {
    if (!draft) return;
    const [lng, lat] = draft.center ?? [120.2, 30.3];
    const spot: Spot = {
      id: `spot-${draft.id}-${Date.now().toString(36)}`,
      name: '新景点',
      districtId: draft.id,
      lng,
      lat,
      summary: '',
      tags: draft.tags.length ? [draft.tags[0]] : ['历史文化'],
      hot: false,
      duration: '半天',
      updatedAt: today(),
    };
    setDraftSpots((list) => [...list, spot]);
  }

  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    if (errors.length > 0) {
      toast(`还有 ${errors.length} 项需要修正`);
      return false;
    }
    const cleanedSpots = draftSpots.map((s) => ({
      ...s,
      name: s.name.trim(),
      summary: s.summary.trim(),
      updatedAt: today(),
    }));
    const cleaned = { ...normalizeDistrict(draft, cleanedSpots), updatedAt: today() };
    await useData.getState().applyDistrictEdits(cleaned, cleanedSpots);
    setDraft(clone(cleaned));
    setDraftSpots(clone(cleanedSpots));
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    refreshPins();
    updateMarkers();
    toast(`${cleaned.name} 已保存到本机`);
    return true;
  }

  async function handleImport(file: File) {
    await importContentBundleFile(file);
    const fresh = useData.getState().districts;
    const id = selectedId && fresh[selectedId] ? selectedId : Object.keys(fresh)[0];
    if (id) {
      setSelectedId(id);
      setDraft(clone(fresh[id]));
      setDraftSpots(clone(useData.getState().spotsByDistrict[id] ?? []));
    }
    setSavedAt(null);
  }

  async function handleRemoveDistrict() {
    if (!draft) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    const name = draft.name;
    const removedId = draft.id;
    await useData.getState().removeDistrictContent(removedId);
    const fresh = useData.getState().districts;
    const next = Object.values(fresh).find((d) => d.id !== removedId);
    if (next) {
      setSelectedId(next.id);
      setDraft(clone(next));
      setDraftSpots(clone(useData.getState().spotsByDistrict[next.id] ?? []));
    } else {
      setSelectedId(null);
      setDraft(null);
      setDraftSpots([]);
    }
    setConfirmRemove(false);
    refreshPins();
    updateMarkers();
    toast(`${name} 的内容已移除，板块回到「未录入」`);
  }

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await useData.getState().resetContent();
    const fresh = useData.getState().districts;
    const keep = selectedId && fresh[selectedId] ? selectedId : Object.keys(fresh)[0];
    if (keep) {
      setSelectedId(keep);
      setDraft(clone(fresh[keep]));
      setDraftSpots(clone(useData.getState().spotsByDistrict[keep] ?? []));
    }
    setConfirmReset(false);
    setSavedAt(null);
    refreshPins();
    updateMarkers();
    toast('已重置为静态内容');
  }

  const editedHere = draft ? editedIds.includes(draft.id) : false;

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <section className="data-panel" onPointerDown={(e) => e.stopPropagation()}>
        <header className="data-head">
          <div className="data-head-title">
            <div className="drawer-kicker">数据管理 · 本地内容</div>
            <h2 className="drawer-title">内容编辑器</h2>
          </div>
          <div className="data-head-stats">
            <span>
              <b>{Object.keys(districts).length}</b> 区县
            </span>
            <span>
              <b>{spotCount}</b> 景点
            </span>
            <span className={editedIds.length ? 'is-accent' : undefined}>
              <b>{editedIds.length}</b> 已编辑
            </span>
          </div>
          <button className="icon-btn" onClick={() => close(false)} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="data-body">
          <aside className="data-rail">
            <div className="data-rail-head">
              <input
                className="input data-search"
                value={query}
                placeholder="筛选区县 / 标签…"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="data-rail-scroll">
              {filteredGroups.map(([city, list]) => (
                <div className="data-group" key={city}>
                  <div className="data-group-title">
                    {city}
                    <span>{list.length}</span>
                  </div>
                  {list.map((d) => (
                    <button
                      key={d.id}
                      className={`data-row${d.id === selectedId ? ' is-active' : ''}`}
                      onClick={() => requestSelect(d.id)}
                    >
                      <span className={`data-dot${editedIds.includes(d.id) ? ' is-edited' : ''}`} />
                      <span className="data-row-name">{d.name}</span>
                      <span className="data-row-sub">{d.spots.length}</span>
                    </button>
                  ))}
                </div>
              ))}
              {filteredGroups.length === 0 && <p className="data-empty">没有匹配的区县</p>}
            </div>
          </aside>

          <div className="data-main">
            {!draft ? (
              <p className="data-empty data-empty--main">暂无可编辑的区县内容。</p>
            ) : (
              <>
                <header className="data-editor-head">
                  <div>
                    <div className="data-editor-kicker">
                      {draft.province} · {draft.city} · {draft.id}
                    </div>
                    <h3 className="data-editor-title">{draft.name}</h3>
                  </div>
                  <div className="data-editor-meta">
                    <span className={`data-badge${editedHere ? ' is-edited' : ''}`}>
                      {editedHere ? '已编辑' : '静态内容'}
                    </span>
                    {dirty && <span className="data-badge is-dirty">未保存</span>}
                    <button
                      className={`data-danger-link${confirmRemove ? ' is-danger' : ''}`}
                      onClick={handleRemoveDistrict}
                    >
                      {confirmRemove ? '确认移除该区县内容？' : '移除该区县内容'}
                    </button>
                  </div>
                </header>

                {pendingId && (
                  <div className="data-confirm">
                    <span>当前区县有未保存修改，切换会丢弃这些修改。</span>
                    <button className="ghost-btn" onClick={() => setPendingId(null)}>
                      继续编辑
                    </button>
                    <button className="ghost-btn is-danger" onClick={() => loadDraft(pendingId)}>
                      放弃并切换
                    </button>
                  </div>
                )}

                <div className="data-scroll">
                  <section className="data-section">
                    <h4 className="data-section-title">
                      <i />
                      基础信息
                    </h4>
                    <div className="data-grid">
                      <Field
                        label="一句话推荐"
                        hint={`${draft.oneLiner.length}/60`}
                        error={errorOf('oneLiner')}
                        className="field--wide"
                      >
                        <textarea
                          className="input input--area"
                          rows={2}
                          value={draft.oneLiner}
                          placeholder="一句话说明这个地方值不值得去"
                          onChange={(e) => update({ oneLiner: e.target.value })}
                        />
                      </Field>
                      <Field label="标签" hint="1–4 个" error={errorOf('tags')} className="field--wide">
                        <TagPicker value={draft.tags} onChange={(tags: Tag[]) => update({ tags })} />
                      </Field>
                      <Field label="更新时间" error={errorOf('updatedAt')}>
                        <input
                          className="input"
                          type="date"
                          value={draft.updatedAt}
                          onChange={(e) => update({ updatedAt: e.target.value })}
                        />
                      </Field>
                      <Field label="所属" hint="由 GeoJSON / 内容文件决定">
                        <input
                          className="input"
                          value={`${draft.province} · ${draft.city}`}
                          readOnly
                          disabled
                        />
                      </Field>
                    </div>
                  </section>

                  <section className="data-section">
                    <h4 className="data-section-title">
                      <i />
                      内容块
                    </h4>
                    <div className="data-grid">
                      <Field label="历史" className="field--wide">
                        <textarea
                          className="input input--area"
                          rows={3}
                          value={draft.history ?? ''}
                          placeholder="建置沿革、关键历史节点…"
                          onChange={(e) => update({ history: e.target.value })}
                        />
                      </Field>
                      <Field label="人文" className="field--wide">
                        <textarea
                          className="input input--area"
                          rows={3}
                          value={draft.culture ?? ''}
                          placeholder="街区气质、民俗、生活方式…"
                          onChange={(e) => update({ culture: e.target.value })}
                        />
                      </Field>
                      <Field label="特色" hint="每行一条" className="field--wide">
                        <textarea
                          className="input input--area"
                          rows={3}
                          value={(draft.features ?? []).join('\n')}
                          placeholder={'例如：南宋御街\n西湖十景'}
                          onChange={(e) => update({ features: e.target.value.split('\n') })}
                        />
                      </Field>
                    </div>
                    <Field label="名人">
                      <PeopleEditor
                        value={draft.people ?? []}
                        onChange={(people) => update({ people })}
                      />
                    </Field>
                  </section>

                  <section className="data-section">
                    <h4 className="data-section-title">
                      <i />
                      美食
                      <span className="data-section-count">{(draft.foods ?? []).length}</span>
                    </h4>
                    <FoodsEditor value={draft.foods ?? []} onChange={(foods) => update({ foods })} />
                  </section>

                  <section className="data-section">
                    <h4 className="data-section-title">
                      <i />
                      特产 · 非遗
                      <span className="data-section-count">{(draft.specialties ?? []).length}</span>
                    </h4>
                    <SpecialtiesEditor
                      value={draft.specialties ?? []}
                      onChange={(specialties) => update({ specialties })}
                    />
                  </section>

                  <section className="data-section">
                    <h4 className="data-section-title">
                      <i />
                      景点
                      <span className="data-section-count">{draftSpots.length}</span>
                    </h4>
                    <div className="spot-editor-list">
                      {draftSpots.map((spot) => (
                        <SpotEditor
                          key={spot.id}
                          spot={spot}
                          update={(patch) => updateSpot(spot.id, patch)}
                          remove={() => setDraftSpots((list) => list.filter((s) => s.id !== spot.id))}
                          errorOf={(field) => spotErrorOf(spot.id, field)}
                        />
                      ))}
                    </div>
                    <button type="button" className="repeat-add" onClick={addSpot}>
                      + 添加景点
                    </button>
                  </section>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="data-foot">
          <div className="data-validation">
            {errors.length > 0 ? (
              <span className="is-err">✕ {errors.length} 项待修正</span>
            ) : (
              <span className="is-ok">✓ 校验通过</span>
            )}
            {warnings.length > 0 && <span className="is-warn">{warnings.length} 条建议</span>}
            {dirty && <span className="is-dirty">未保存</span>}
            {!dirty && savedAt && <span className="is-saved">已保存 {savedAt}</span>}
          </div>
          <div className="data-foot-actions">
            <button
              className={`ghost-btn${confirmReset ? ' is-danger' : ''}`}
              onClick={handleReset}
              disabled={editedIds.length === 0 && !dirty}
            >
              {confirmReset ? '确认重置全部？' : '重置编辑'}
            </button>
            <button className="ghost-btn" onClick={() => fileRef.current?.click()} disabled={!draft}>
              导入
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImport(file);
                e.target.value = '';
              }}
            />
            <button
              className="primary-btn data-save"
              onClick={() => void handleSave()}
              disabled={!dirty || errors.length > 0}
            >
              保存到本机
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SpotEditor({
  spot,
  update,
  remove,
  errorOf,
}: {
  spot: Spot;
  update: (patch: Partial<Spot>) => void;
  remove: () => void;
  errorOf: (field: string) => string | undefined;
}) {
  return (
    <article className="spot-edit">
      <div className="spot-edit-head">
        <input
          className="input input--title"
          value={spot.name}
          placeholder="景点名称"
          onChange={(e) => update({ name: e.target.value })}
        />
        <label className="spot-hot">
          <input
            type="checkbox"
            checked={Boolean(spot.hot)}
            onChange={(e) => update({ hot: e.target.checked })}
          />
          热门
        </label>
        <button type="button" className="repeat-remove" title="从草稿移除" onClick={remove}>
          ×
        </button>
      </div>
      <div className="data-grid data-grid--spot">
        <Field label="简介" className="field--wide" error={errorOf('summary')}>
          <textarea
            className="input input--area"
            rows={2}
            value={spot.summary}
            placeholder="60–80 字，说明看什么、适合谁"
            onChange={(e) => update({ summary: e.target.value })}
          />
        </Field>
        <Field label="标签" className="field--wide" error={errorOf('tags')}>
          <TagPicker value={spot.tags} onChange={(tags: Tag[]) => update({ tags })} />
        </Field>
        <Field label="经度" error={errorOf('lng')}>
          <input
            className="input"
            type="number"
            step="0.0001"
            value={Number.isFinite(spot.lng) ? spot.lng : ''}
            onChange={(e) => update({ lng: e.target.valueAsNumber })}
          />
        </Field>
        <Field label="纬度" error={errorOf('lat')}>
          <input
            className="input"
            type="number"
            step="0.0001"
            value={Number.isFinite(spot.lat) ? spot.lat : ''}
            onChange={(e) => update({ lat: e.target.valueAsNumber })}
          />
        </Field>
        <Field label="建议时长">
          <input
            className="input"
            value={spot.duration ?? ''}
            placeholder="2小时 / 半天"
            onChange={(e) => update({ duration: e.target.value })}
          />
        </Field>
        <Field label="id" hint="只读，用于收藏引用">
          <input className="input" value={spot.id} readOnly disabled />
        </Field>
      </div>
    </article>
  );
}
