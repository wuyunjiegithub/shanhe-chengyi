import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { useTravelNotes } from '../../stores/travelNotes';
import type { NotePlaceKind, TravelNote } from '../../stores/travelNotes';
import { deleteImage, imageUrl, saveImage } from '../../data/imageStore';
import { imgToken, stripImgTokens } from '../../data/noteBody';
import { NotePhotoPicker } from './NotePhotoPicker';
import type { PickedPhoto } from './NotePhotoPicker';
import { NoteBodyView } from './NoteBodyView';

const MAX_IMAGES = 9;

function fmtDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface PlaceOption {
  kind: NotePlaceKind;
  id: string;
  name: string;
  sub: string;
}

/* ================= 编辑器 ================= */

interface NoteEditorProps {
  initial: TravelNote | null;
  /** 新建时的预置关联地点（从区县抽屉/城市面板跳转进来时带） */
  initialPlace?: PlaceOption | null;
  /** 从区县详情/城市面板跳来新建时锁定关联地点（避免误改到别处） */
  lockPlace?: boolean;
  places: PlaceOption[];
  onSave: (draft: {
    title: string;
    body: string;
    placeKind: NotePlaceKind | null;
    placeId: string | null;
    placeName: string;
    images: string[];
  }) => void;
  /** 编辑过程中自动落库（防抖），保证 ESC 关闭 / 误触返回不丢内容 */
  onAutoSave?: (draft: {
    title: string;
    body: string;
    placeKind: NotePlaceKind | null;
    placeId: string | null;
    placeName: string;
    images: string[];
  }) => void;
  onDelete: (() => void) | null;
  onCancel: () => void;
  /** 直接关闭整个面板（编辑器态也能一键关掉，不停在返回列表） */
  onClosePanel?: () => void;
  showToast: (msg: string) => void;
}

function NoteEditor({ initial, initialPlace = null, lockPlace = false, places, onSave, onAutoSave, onDelete, onCancel, onClosePanel, showToast }: NoteEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [place, setPlace] = useState<PlaceOption | null>(() => {
    if (initial?.placeId && initial.placeKind) {
      return (
        places.find((p) => p.kind === initial.placeKind && p.id === initial.placeId) ?? {
          kind: initial.placeKind,
          id: initial.placeId,
          name: initial.placeName,
          sub: '',
        }
      );
    }
    return initialPlace;
  });
  const [images, setImages] = useState<string[]>(initial?.images ?? []);
  const [urls, setUrls] = useState<Record<string, string>>({});
  /**
   * 编辑器是「保存才生效」的语义，所以图片的增删都必须延到保存那一刻才落盘：
   * - pendingRemoval：本次编辑里被移除的图，取消时不能删（store 里的游记还引用着它们，
   *   删了字节就等于给游记造出永久裂图）；
   * - pendingAdded：本次编辑里新写入的图，取消时没有归属，应当回收字节。
   */
  const pendingRemoval = useRef<Set<string>>(new Set());
  const pendingAdded = useRef<Set<string>>(new Set());
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  /** 插入照片后滚到这里：正文效果是「图文混排后的样子」，看完才知道图片落在哪一段 */
  const previewRef = useRef<HTMLDivElement>(null);
  /** 正文光标位置：图片插在光标处，而不是一律追加到末尾 */
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<number | null>(null);

  /* ---------- 自动保存 ----------
   * 编辑过程中按 500ms 防抖落库；卸载时若有未落库改动立即冲刷。
   * 这样即使按 ESC 关闭弹框、或误触返回列表，也不会丢掉刚写的内容。 */
  const autoSaveRef = useRef(onAutoSave);
  autoSaveRef.current = onAutoSave;
  const dirtyRef = useRef(false);
  const draftRef = useRef({ title, body, place, images });
  draftRef.current = { title, body, place, images };

  // 初始快照：与当前值一致时不触发保存（避免「打开编辑器即改动 updatedAt」）
  const initSigRef = useRef(
    JSON.stringify({
      title: initial?.title ?? '',
      body: initial?.body ?? '',
      placeKind: initial?.placeKind ?? initialPlace?.kind ?? null,
      placeId: initial?.placeId ?? initialPlace?.id ?? null,
      images: initial?.images ?? [],
    }),
  );
  const curSig = JSON.stringify({
    title,
    body,
    placeKind: place?.kind ?? null,
    placeId: place?.id ?? null,
    images,
  });

  useEffect(() => {
    if (curSig === initSigRef.current) return;
    if (!title.trim() && !body.trim()) return;
    dirtyRef.current = true;
    const t = window.setTimeout(() => {
      autoSaveRef.current?.({
        title,
        body,
        placeKind: place?.kind ?? null,
        placeId: place?.id ?? null,
        placeName: place?.name ?? '',
        images,
      });
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curSig]);

  useEffect(
    () => () => {
      if (!dirtyRef.current) return;
      const d = draftRef.current;
      if (!d.title.trim() && !d.body.trim()) return;
      autoSaveRef.current?.({
        title: d.title,
        body: d.body,
        placeKind: d.place?.kind ?? null,
        placeId: d.place?.id ?? null,
        placeName: d.place?.name ?? '',
        images: d.images,
      });
    },
    [],
  );

  // 图片 id -> ObjectURL（编辑器打开/图片变化时解析，卸载时释放）
  useEffect(() => {
    let revoked = false;
    const pending = images.filter((id) => !urls[id]);
    if (pending.length === 0) return;
    void Promise.all(pending.map((id) => imageUrl(id))).then((loaded) => {
      if (revoked) {
        loaded.forEach((u) => u && URL.revokeObjectURL(u));
        return;
      }
      setUrls((prev) => {
        const next = { ...prev };
        pending.forEach((id, i) => {
          if (loaded[i]) next[id] = loaded[i];
        });
        return next;
      });
    });
    return () => {
      revoked = true;
    };
    // urls 故意不进依赖：只补缺失的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  useEffect(
    () => () => {
      // 组件卸载时释放全部 ObjectURL
      setUrls((prev) => {
        for (const u of Object.values(prev)) URL.revokeObjectURL(u);
        return {};
      });
    },
    [],
  );

  const placeHits = useMemo(() => {
    const q = placeQuery.trim();
    if (!q) return [];
    return places
      .filter((p) => p.name.includes(q) || p.sub.includes(q))
      .slice(0, 8);
  }, [placeQuery, places]);

  const onRemoveImage = (id: string) => {
    setImages((prev) => prev.filter((x) => x !== id));
    // 正文里引用这张图的占位行一起删掉，否则渲染时会留一个永远读不出来的图
    setBody((prev) => {
      const token = imgToken(id);
      if (!prev.includes(token)) return prev;
      return prev
        .split('\n')
        .filter((line) => line.trim() !== token)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');
    });
    setUrls((prev) => {
      const next = { ...prev };
      if (next[id]) URL.revokeObjectURL(next[id]);
      delete next[id];
      return next;
    });
    // 本次编辑里新加的图：还没进 store，直接回收字节即可
    if (pendingAdded.current.delete(id)) {
      void deleteImage(id).catch(() => undefined);
      return;
    }
    // 老图只登记，等保存时才删——否则用户放弃编辑，游记里这张图就永久裂了
    pendingRemoval.current.add(id);
  };

  const flushImages = (committed: boolean) => {
    if (committed) {
      for (const id of pendingRemoval.current) void deleteImage(id).catch(() => undefined);
    } else {
      for (const id of pendingAdded.current) void deleteImage(id).catch(() => undefined);
    }
    pendingRemoval.current.clear();
    pendingAdded.current.clear();
  };

  const onCancelEdit = () => {
    flushImages(false);
    onCancel();
  };

  /**
   * 把图片占位插到正文里：有光标就插在光标处，没有就追加到正文末尾。
   * 正文是纯文本框，图片以 `{{图:id}}` 占位，「正文效果」里才换成真图。
   */
  const insertTokens = (ids: string[]) => {
    if (ids.length === 0) return;
    const block = ids.map(imgToken).join('\n\n');
    setBody((prev) => {
      const pos = caretRef.current;
      if (pos == null || pos < 0 || pos > prev.length) {
        const sep = !prev.trim() ? '' : prev.endsWith('\n\n') ? '' : prev.endsWith('\n') ? '\n' : '\n\n';
        const next = `${prev}${sep}${block}\n\n`;
        caretRef.current = next.length;
        return next;
      }
      const before = prev.slice(0, pos);
      const after = prev.slice(pos);
      const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const tail = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      const next = `${before}${lead}${block}${tail}${after}`;
      caretRef.current = before.length + lead.length + block.length;
      return next;
    });
  };

  /** 照片库挑选器确认：把勾选的本地照片复制进本篇游记，并插进正文光标处 */
  const onLibConfirm = async (items: PickedPhoto[]) => {
    setBusy(true);
    const atCaret = caretRef.current != null && caretRef.current > 0;
    try {
      const ids: string[] = [];
      for (const it of items) {
        try {
          ids.push(await saveImage(it.blob, it.name));
        } catch {
          showToast(`${it.name} 保存失败`);
        }
      }
      if (ids.length > 0) {
        setImages((prev) => [...prev, ...ids]);
        for (const id of ids) pendingAdded.current.add(id);
        insertTokens(ids);
        // 滚到「正文效果」，插完立刻看到图落在哪一段
        window.setTimeout(() => previewRef.current?.scrollIntoView({ block: 'nearest' }), 60);
      }
      showToast(
        ids.length > 0
          ? `已插入 ${ids.length} 张${atCaret ? '到正文光标处' : '到正文末尾'}，下方「正文效果」可预览`
          : '没有可添加的照片',
      );
    } finally {
      setBusy(false);
      setLibOpen(false);
    }
  };

  const onSaveClick = () => {
    if (!title.trim() && !body.trim()) {
      showToast('写点什么再保存');
      return;
    }
    onSave({
      title,
      body,
      placeKind: place?.kind ?? null,
      placeId: place?.id ?? null,
      placeName: place?.name ?? '',
      images,
    });
    flushImages(true);
  };

  return (
    <div className="note-editor">
      <header className="note-editor-head">
        <button className="ghost-btn" onClick={onCancelEdit}>
          ‹ 返回列表
        </button>
        <span className="note-editor-date">
          {initial ? `创建于 ${fmtDate(initial.createdAt)}` : '新游记'}
        </span>
        {onClosePanel && (
          <button className="icon-btn" onClick={onClosePanel} title="关闭游记面板" aria-label="关闭">
            ×
          </button>
        )}
        <button className="primary-btn" onClick={onSaveClick} disabled={busy}>
          保存
        </button>
      </header>

      <input
        className="note-title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题，例如：徽杭古道两日"
        maxLength={40}
      />

      <div className="note-place">
        {place ? (
          <span className="note-place-chip">
            <span className="note-place-pin">📍</span>{place.name}
            {!lockPlace && (
              <button className="note-place-clear" onClick={() => setPlace(null)} title="取消关联">
                ×
              </button>
            )}
          </span>
        ) : (
          <div className="note-place-picker">
            <input
              value={placeQuery}
              onChange={(e) => {
                setPlaceQuery(e.target.value);
                setPlaceOpen(true);
              }}
              onFocus={() => setPlaceOpen(true)}
              onBlur={() => window.setTimeout(() => setPlaceOpen(false), 120)}
              placeholder="关联地点（可选）：输入城市或区县名"
            />
            {placeOpen && placeHits.length > 0 && (
              <ul className="note-place-list">
                {placeHits.map((p) => (
                  <li key={`${p.kind}-${p.id}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPlace(p);
                        setPlaceQuery('');
                        setPlaceOpen(false);
                      }}
                    >
                      <span className="note-place-list-name">{p.name}</span>
                      <span className="note-place-list-sub">{p.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <textarea
        ref={bodyRef}
        className="note-body-input"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          caretRef.current = e.target.selectionStart;
        }}
        onSelect={(e) => {
          caretRef.current = e.currentTarget.selectionStart;
        }}
        onFocus={(e) => {
          caretRef.current = e.currentTarget.selectionStart;
        }}
        placeholder="正文：走了哪些地方、吃了什么、遇见什么人和事……空行分段。光标停在哪，图片就插在哪。"
        rows={12}
      />

      {/* 图文混排后的真实效果：正文里的 {{图:…}} 在这里变成图片 */}
      <div className="note-preview" ref={previewRef}>
        <div className="note-preview-head">
          <span>正文效果</span>
          <span className="note-preview-hint">图片按正文顺序排版 · 光标停在正文某处再插图片，图就落在那里</span>
        </div>
        <NoteBodyView body={body} urls={urls} emptyHint="写点正文，或插几张照片看看效果" />
      </div>

      <div className="note-images">
        <div className="note-images-head">
          <span>
            图片 <b>{images.length}</b> / {MAX_IMAGES}
          </span>
          <div className="note-images-acts">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setLibOpen(true)}
              disabled={busy || images.length >= MAX_IMAGES}
              title="从绑定的本地照片库挑选（可多选，批量插入正文光标处）"
            >
              {busy ? '插入中…' : '＋ 插入照片'}
            </button>
          </div>
        </div>
        {images.length > 0 && (
          <ul className="note-image-grid">
            {images.map((id) => (
              <li key={id}>
                {urls[id] ? (
                  <img src={urls[id]} alt="游记图片" loading="lazy" />
                ) : (
                  <span className="note-image-loading">…</span>
                )}
                <button
                  className="note-image-insert"
                  onClick={() => {
                    bodyRef.current?.focus();
                    insertTokens([id]);
                  }}
                  title="把这张图插到正文光标处"
                >
                  ⤴ 正文
                </button>
                <button className="note-image-remove" onClick={() => onRemoveImage(id)} title="移除图片">
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {onDelete && (
        <footer className="note-editor-foot">
          <button
            className={`ghost-btn${confirmDelete ? ' is-danger' : ''}`}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                window.setTimeout(() => setConfirmDelete(false), 4000);
                return;
              }
              onDelete();
            }}
          >
            {confirmDelete ? '确认删除这篇游记？' : '删除游记'}
          </button>
        </footer>
      )}

      {/* 照片库挑选器：列出该地点绑定目录下的照片，多选批量导入 */}
      {libOpen && (
        <NotePhotoPicker
          place={place ? { kind: place.kind, id: place.id, name: place.name } : null}
          room={Math.max(0, MAX_IMAGES - images.length)}
          onConfirm={onLibConfirm}
          onClose={() => setLibOpen(false)}
        />
      )}
    </div>
  );
}

/* ================= 列表面板 ================= */

export function TravelNotesPanel() {
  const open = useUi((s) => s.travelOpen);
  const close = useUi((s) => s.toggleTravelPanel);
  const prefill = useUi((s) => s.travelPrefill);
  const setPrefill = useUi((s) => s.setTravelPrefill);
  const notes = useTravelNotes((s) => s.notes);
  const createNote = useTravelNotes((s) => s.createNote);
  const updateNote = useTravelNotes((s) => s.updateNote);
  const removeNote = useTravelNotes((s) => s.removeNote);
  const showToast = useUi((s) => s.showToast);
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  const districtNames = useData((s) => s.districtNames);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingPlace, setPendingPlace] = useState<PlaceOption | null>(null);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  /** 新建游记被自动保存后拿到的 id：后续自动保存继续更新这篇，避免重复创建 */
  const autoIdRef = useRef<string | null>(null);

  const places: PlaceOption[] = useMemo(() => {
    const list: PlaceOption[] = cities.map((c) => ({
      kind: 'city' as NotePlaceKind,
      id: c.id,
      name: c.name,
      sub: `${c.province} · 城市`,
    }));
    for (const [id, d] of Object.entries(districts)) {
      list.push({ kind: 'district', id, name: d.name, sub: `${d.city} · 区县` });
    }
    // 未录入区县也允许关联（GeoJSON 名称）
    for (const [id, name] of Object.entries(districtNames)) {
      if (!districts[id]) list.push({ kind: 'district', id, name, sub: '区县' });
    }
    return list;
  }, [cities, districts, districtNames]);

  // 列表封面图：取每篇第一篇图
  useEffect(() => {
    if (!open) return;
    const wanted = notes.map((n) => n.images[0]).filter((id): id is string => Boolean(id));
    const missing = wanted.filter((id) => !coverUrls[id]);
    if (missing.length === 0) return;
    let revoked = false;
    void Promise.all(missing.map((id) => imageUrl(id))).then((loaded) => {
      if (revoked) {
        loaded.forEach((u) => u && URL.revokeObjectURL(u));
        return;
      }
      setCoverUrls((prev) => {
        const next = { ...prev };
        missing.forEach((id, i) => {
          if (loaded[i]) next[id] = loaded[i];
        });
        return next;
      });
    });
    return () => {
      revoked = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, notes]);

  // 这块组件始终挂载、靠 open 控制显隐，所以关闭面板时要主动回收封面 blob：
  // 否则每开关一次游记面板就新攒一批 object URL，整张原图字节都无法被 GC。
  const coverUrlsRef = useRef<Record<string, string>>({});
  coverUrlsRef.current = coverUrls;
  useEffect(() => {
    if (open) return;
    setCoverUrls((prev) => {
      for (const u of Object.values(prev)) URL.revokeObjectURL(u);
      return {};
    });
  }, [open]);
  useEffect(
    () => () => {
      for (const u of Object.values(coverUrlsRef.current)) URL.revokeObjectURL(u);
    },
    [],
  );

  // 从区县抽屉/城市面板跳来：带预置地点开一篇新游记
  useEffect(() => {
    if (!open || !prefill) return;
    autoIdRef.current = null;
    setPendingPlace({
      kind: prefill.kind,
      id: prefill.id,
      name: prefill.name,
      sub: prefill.kind === 'city' ? '城市' : '区县',
    });    setCreating(true);
    setEditingId(null);
    setPrefill(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const editing = editingId ? notes.find((n) => n.id === editingId) ?? null : null;

  /** 自动保存回调：编辑已有 → 更新它；新建且已自动创建 → 更新那篇；否则新建并记住 id */
  const handleAutoSave = (draft: {
    title: string;
    body: string;
    placeKind: NotePlaceKind | null;
    placeId: string | null;
    placeName: string;
    images: string[];
  }) => {
    if (editing) updateNote(editing.id, draft);
    else if (autoIdRef.current) updateNote(autoIdRef.current, draft);
    else autoIdRef.current = createNote(draft).id;
  };

  // 关闭面板时重置编辑状态：否则 ESC 关闭后再次打开会停留在上一次的空白编辑器，
  // 看起来像「刚写的游记没了」，还可能把已自动保存的内容覆盖掉。
  useEffect(() => {
    if (open) return;
    setCreating(false);
    setEditingId(null);
    setPendingPlace(null);
    autoIdRef.current = null;
  }, [open]);

  if (!open) return null;

  const lockPlace = !editing && !!pendingPlace;

  const exitEditor = () => {
    setCreating(false);
    setEditingId(null);
    setPendingPlace(null);
    autoIdRef.current = null;
  };

  if (creating || editing) {
    const draftPlace = editing?.placeId
      ? places.find((p) => p.kind === editing.placeKind && p.id === editing.placeId) ?? null
      : pendingPlace;
    return (
      <div className="modal-backdrop" onPointerDown={() => close(false)}>
        <section className="fav-panel travel-panel" onPointerDown={(e) => e.stopPropagation()}>
          <NoteEditor
            // key 带预置地点 id：面板开着时从别处再点「写游记」，编辑器要整体重来，
            // 否则 place state 留着旧地点（表现为「在城市打开的游记却关联到淳安」）
            key={editing?.id ?? `new-${pendingPlace?.id ?? 'x'}`}
            initial={editing}
            places={places}
            initialPlace={draftPlace}
            lockPlace={lockPlace}
            onSave={(draft) => {
              if (editing) {
                updateNote(editing.id, draft);
                showToast('游记已更新');
              } else if (autoIdRef.current) {
                updateNote(autoIdRef.current, draft);
                showToast('游记已保存');
              } else {
                createNote(draft);
                showToast('游记已保存');
              }
              exitEditor();
            }}
            onAutoSave={handleAutoSave}
            onDelete={
              editing
                ? () => {
                    removeNote(editing.id);
                    showToast('游记已删除');
                    exitEditor();
                  }
                : null
            }
            onCancel={exitEditor}
            onClosePanel={() => close(false)}
            showToast={showToast}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onPointerDown={() => close(false)}>
      <section className="fav-panel travel-panel" onPointerDown={(e) => e.stopPropagation()}>
        <header className="fav-head">
          <div>
            <div className="drawer-kicker">旅行游记</div>
            <div className="fav-title-line">
              <h2 className="drawer-title">我的游记</h2>
              <span className="fav-total">{notes.length} 篇</span>
            </div>
          </div>
          <button className="icon-btn" onClick={() => close(false)} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="fav-body">
          {notes.length === 0 ? (
            <p className="block-empty">
              还没有游记。在区县或城市详情里点「写游记」即可记录一路见闻，支持多张图片
              （从本地照片库批量挑选插入），并自动关联到该地点。
            </p>
          ) : (
            <ul className="note-list">
              {notes.map((n) => {
                const cover = n.images.length > 0 ? coverUrls[n.images[0]] : undefined;
                return (
                  <li key={n.id}>
                    <button
                      className="note-card"
                      onClick={() => {
                        autoIdRef.current = null;
                        setEditingId(n.id);
                      }}
                    >
                      <span className="note-card-cover">
                        {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="note-card-cover-ph" />}
                      </span>
                      <span className="note-card-body">
                        <span className="note-card-title">{n.title}</span>
                        {n.placeName && <span className="note-card-place">{n.placeName}</span>}
                        <span className="note-card-excerpt">
                          {stripImgTokens(n.body).slice(0, 60) || (n.images.length > 0 ? '（纯图记录）' : '（正文为空）')}
                        </span>
                        <span className="note-card-meta">
                          {fmtDate(n.updatedAt)}
                          {n.images.length > 0 && ` · ${n.images.length} 图`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
