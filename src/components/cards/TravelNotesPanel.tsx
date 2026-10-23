import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../../stores/data';
import { useUi } from '../../stores/ui';
import { useTravelNotes } from '../../stores/travelNotes';
import type { NotePlaceKind, TravelNote } from '../../stores/travelNotes';
import { deleteImage, imageUrl, saveImage } from '../../data/imageStore';
import { noteHtmlToPlain, noteImageIds, toNoteHtml } from '../../data/noteBody';
import { NotePhotoPicker } from './NotePhotoPicker';
import type { PickedPhoto } from './NotePhotoPicker';
import { NoteRichEditor } from './NoteRichEditor';
import type { NoteRichEditorHandle } from './NoteRichEditor';

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
  /**
   * 正文是富文本 HTML。旧游记是纯文本 + `{{图:id}}`，这里统一转成 HTML；
   * 组件按游记 id 做了 key，切换游记会整体重挂载，所以只在挂载时算一次。
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialHtml = useMemo(() => toNoteHtml(initial?.body ?? ''), [initial?.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialImages = useMemo(() => initial?.images ?? [], [initial?.id]);

  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initialHtml);
  /** 笔记拥有的图片 = 正文里出现的 data-img（按顺序去重），不再单独维护一份列表 */
  const images = useMemo(() => noteImageIds(body), [body]);
  const imageKey = images.join('|');

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
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  const editorRef = useRef<NoteRichEditorHandle>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  /** 是否已经自动落过库：决定「返回列表」时能不能回收本次新写入的图片字节 */
  const autoSavedRef = useRef(false);

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
      body: initialHtml,
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

  const bodyText = noteHtmlToPlain(body);

  useEffect(() => {
    if (curSig === initSigRef.current) return;
    if (!title.trim() && !bodyText.trim()) return;
    dirtyRef.current = true;
    const t = window.setTimeout(() => {
      autoSavedRef.current = true;
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

  /* ---------- 图片：正文里的 id -> object URL ---------- */
  useEffect(() => {
    const ids = imageKey ? imageKey.split('|') : [];
    const missing = ids.filter((id) => !urlsRef.current[id]);
    if (missing.length === 0) return;
    let revoked = false;
    void Promise.all(missing.map((id) => imageUrl(id)))
      .then((loaded) => {
        if (revoked) {
          loaded.forEach((u) => u && URL.revokeObjectURL(u));
          return;
        }
        setUrls((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            const u = loaded[i];
            if (u) next[id] = u;
          });
          return next;
        });
      })
      .catch((err) => {
        // 读库失败不能让正文永久显示空白块：至少把原因抛到控制台，便于排查
        console.warn('[note] 图片读取失败', err);
      });
    return () => {
      revoked = true;
    };
  }, [imageKey]);

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

  /** 照片库挑选器确认：把勾选的本地照片复制进本篇游记，并插到正文光标处 */
  const onLibConfirm = async (items: PickedPhoto[]) => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const it of items) {
        try {
          ids.push(await saveImage(it.blob, it.name));
        } catch {
          showToast(`${it.name} 保存失败`);
        }
      }
      if (ids.length === 0) {
        showToast('没有可添加的照片');
        return;
      }
      // 先把显示地址准备好，插进正文后立刻就能看到图，不用等下一帧
      const loaded = await Promise.all(ids.map(async (id) => [id, await imageUrl(id)] as const));
      const add: Record<string, string> = {};
      for (const [id, u] of loaded) if (u) add[id] = u;
      urlsRef.current = { ...urlsRef.current, ...add };
      setUrls((prev) => ({ ...prev, ...add }));
      editorRef.current?.insertImages(ids.map((id) => ({ id, url: add[id] })));
      showToast(`已插入 ${ids.length} 张到正文光标处`);
    } finally {
      setBusy(false);
      setLibOpen(false);
    }
  };

  const draftPayload = () => ({
    title,
    body,
    placeKind: place?.kind ?? null,
    placeId: place?.id ?? null,
    placeName: place?.name ?? '',
    images,
  });

  const onSaveClick = () => {
    if (!title.trim() && !bodyText.trim()) {
      showToast('写点什么再保存');
      return;
    }
    onSave(draftPayload());
    // 保存后：本次删掉的老图才真正回收字节（放弃编辑时不能删，见 onCancelEdit）
    const kept = new Set(images);
    for (const id of initialImages) if (!kept.has(id)) void deleteImage(id).catch(() => undefined);
  };

  const onCancelEdit = () => {
    // 本次新加、且还没被自动保存引用过的图片：放弃编辑时回收字节。
    // 若已经自动落库，图片仍被那篇游记引用着，不能删。
    if (!autoSavedRef.current) {
      const keep = new Set(initialImages);
      for (const id of images) if (!keep.has(id)) void deleteImage(id).catch(() => undefined);
    }
    onCancel();
  };

  return (
    <div className="note-editor">
      <header className="note-editor-head">
        <button className="ghost-btn" onClick={onCancelEdit}>
          ‹ 返回列表
        </button>
        <span className="note-editor-date">{initial ? `创建于 ${fmtDate(initial.createdAt)}` : '新游记'}</span>
        {onClosePanel && (
          <button className="icon-btn" onClick={onClosePanel} title="关闭游记面板" aria-label="关闭">
            ×
          </button>
        )}
        <button className="primary-btn" onClick={onSaveClick} disabled={busy}>
          保存
        </button>
      </header>

      {/* 只有这一块滚动：键盘弹出时正文上滚，上面的「返回 / 保存」始终在 */}
      <div className="note-editor-scroll">
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
            <span className="note-place-pin">📍</span>
            {place.name}
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

      {/* 所见即所得：正文就是最终排版，不再另开一块「正文效果」预览 */}
      <NoteRichEditor
        ref={editorRef}
        html={initialHtml}
        urls={urls}
        onChange={setBody}
        onPickImage={() => {
          if (busy || images.length >= MAX_IMAGES) return;
          // 先收起键盘再开选图面板：不然键盘一直浮在面板后面，很吵
          editorRef.current?.blur();
          setLibOpen(true);
        }}
        imageFull={images.length >= MAX_IMAGES}
        placeholder="正文：走了哪些地方、吃了什么、遇见什么事……"
      />

      <div className="rt-bar">
        <span className="rt-count">
          图片 <b>{images.length}</b> / {MAX_IMAGES}
        </span>
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
      </div>

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
          const u = loaded[i];
          if (u) next[id] = u;
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
    });
    setCreating(true);
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
        <section className="fav-panel travel-panel travel-panel--editor" onPointerDown={(e) => e.stopPropagation()}>
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
              还没有游记。在区县或城市详情里点「写游记」即可记录一路见闻；正文支持加粗、标题、引用、列表，
              图片从本地照片库批量挑选后直接插在光标处。
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
                          {noteHtmlToPlain(n.body).slice(0, 60) || (n.images.length > 0 ? '（纯图记录）' : '（正文为空）')}
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
