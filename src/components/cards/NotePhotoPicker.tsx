import { useEffect, useMemo, useState } from 'react';
import { useData } from '../../stores/data';
import { usePhotoLib } from '../../stores/photoLib';
import type { PhotoEntry } from '../../data/photoLibrary';

/**
 * 游记配图的「照片库挑选器」
 * ------------------------
 * 绑定本地目录后，照片已经按「省 / 市 / 区县」归好类了。
 * 写游记点「从照片库挑选」时，直接把该地点目录下的照片列出来多选，
 * 不再弹磁盘选择框让人再去翻文件夹；没绑定 / 目录里没图时，
 * 面板内给出提示，并保留「从磁盘选择」的降级入口。
 */

export interface PickedPhoto {
  name: string;
  blob: Blob;
}

interface NotePhotoPickerProps {
  /** 游记关联的地点；为空时列出全部本地照片 */
  place: { kind: 'city' | 'district'; id: string; name: string } | null;
  /** 还能添加几张 */
  room: number;
  onConfirm: (items: PickedPhoto[]) => void | Promise<void>;
  onClose: () => void;
}

interface LibRow {
  entry: PhotoEntry;
  sub: string;
}

function useLibRows(place: NotePhotoPickerProps['place']): LibRow[] {
  const index = usePhotoLib((s) => s.index);
  const cities = useData((s) => s.cities);
  const districts = useData((s) => s.districts);
  // 只取原语值作记忆依赖：调用方每次渲染都会新建 place 对象，
  // 若直接依赖 place 引用，useMemo 永远不命中，缩略图会反复清空重载（闪烁）。
  const placeKind = place?.kind;
  const placeId = place?.id;
  const placeName = place?.name;

  return useMemo(() => {
    if (!index) return [];
    const rows: LibRow[] = [];
    const seen = new Set<string>();
    const push = (entries: PhotoEntry[] | undefined, sub: string) => {
      for (const entry of entries ?? []) {
        // 游记只放图片：视频 / 动图不进编辑器
        if (entry.kind !== 'image') continue;
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        rows.push({ entry, sub });
      }
    };
    if (placeKind === 'district' && placeId != null) {
      push(index.byDistrict[placeId], placeName ?? '');
    } else if (placeKind === 'city' && placeId != null) {
      push(index.byCity[placeId], placeName ?? '');
      const city = cities.find((c) => c.id === placeId);
      for (const did of city?.districts ?? []) {
        push(index.byDistrict[did], districts[did]?.name ?? '区县');
      }
    } else {
      for (const [did, list] of Object.entries(index.byDistrict)) push(list, districts[did]?.name ?? '区县');
      for (const [cid, list] of Object.entries(index.byCity)) {
        push(list, cities.find((c) => c.id === cid)?.name ?? '城市');
      }
      if (rows.length > 150) return rows.slice(0, 150);
    }
    return rows;
  }, [index, placeKind, placeId, placeName, cities, districts]);
}

/** 单张缩略图：按需解析 object URL（照片库统一走 LRU 缓存，这里不负责释放） */
function LibThumb({
  row,
  selected,
  disabled,
  onToggle,
  onDouble,
}: {
  row: LibRow;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** 双击 = 立刻插入这一张，省掉「勾选 → 再点插入」两步 */
  onDouble: () => void;
}) {
  const photoUrl = usePhotoLib((s) => s.photoUrl);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    void photoUrl(row.entry).then((u) => {
      if (!alive) return;
      if (u) setSrc(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [row, photoUrl]);

  return (
    <button
      type="button"
      className={`np-cell${selected ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={onToggle}
      onDoubleClick={onDouble}
      disabled={disabled}
      title={`${row.entry.name}${row.sub ? ` · ${row.sub}` : ''}（双击直接插入）`}
    >
      <span className="np-cell-img">
        {src ? <img src={src} alt={row.entry.name} loading="lazy" draggable={false} /> : null}
        {!src && !failed && <span className="np-cell-loading">…</span>}
        {failed && <span className="np-cell-failed">读取失败</span>}
        <span className="np-cell-check">{selected ? '✓' : ''}</span>
      </span>
      <span className="np-cell-name">{row.entry.name}</span>
      {row.sub && <span className="np-cell-sub">{row.sub}</span>}
    </button>
  );
}

export function NotePhotoPicker({ place, room, onConfirm, onClose }: NotePhotoPickerProps) {
  const rows = useLibRows(place);
  const photoBlob = usePhotoLib((s) => s.photoBlob);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const pickedRows = useMemo(() => rows.filter((r) => picked.includes(r.entry.path)), [rows, picked]);
  const full = picked.length >= room;

  const toggle = (path: string) => {
    setPicked((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= room) return prev;
      return [...prev, path];
    });
  };

  const selectAll = () => setPicked(rows.slice(0, room).map((r) => r.entry.path));

  const insert = async (rows: LibRow[]) => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const items: PickedPhoto[] = [];
      for (const row of rows) {
        // 直接读字节（套壳 / FSA 都稳定），不再依赖「解析 URL 后 fetch」——
        // Tauri 的 asset:// 链接对 <img> 可用，但 fetch 取不到字节会让添加静默失败。
        try {
          const blob = await photoBlob(row.entry);
          if (blob) items.push({ name: row.entry.name, blob });
        } catch {
          /* 单张失败不影响其余 */
        }
      }
      await onConfirm(items);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => void insert(pickedRows);
  /** 双击单张：直接插入这一张 */
  const insertOne = (row: LibRow) => void insert([row]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="np-backdrop" onPointerDown={onClose}>
      <section className="np-panel" onPointerDown={(e) => e.stopPropagation()}>
        <header className="np-head">
          <div className="np-head-title">
            <div className="drawer-kicker">本地照片库 · 可多选</div>
            <h2 className="np-title">{place ? `${place.name} · 照片` : '全部本地照片'}</h2>
          </div>
          <span className={`np-count${picked.length > 0 ? ' is-on' : ''}`}>
            已选 <b>{picked.length}</b> / 还可选 {room}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        {rows.length === 0 ? (
          <div className="np-empty">
            <p>
              {place
                ? `${place.name} 的目录下还没有可用的照片。`
                : '还没有绑定本地照片库，或目录里没有图片。'}
            </p>
            <p className="np-empty-hint">
              把照片按「省 / 市 / 区县」文件夹放进已绑定目录，点「重新扫描」或开「实时更新」就会出现在这里；
              也可以在下方直接从磁盘选择文件。
            </p>
          </div>
        ) : (
          <div className="np-toolbar">
            <button type="button" className="ghost-btn" onClick={selectAll} disabled={full}>
              全选（最多 {room} 张）
            </button>
            <button type="button" className="ghost-btn" onClick={() => setPicked([])} disabled={picked.length === 0}>
              清空选择
            </button>
            <span className="np-toolbar-note">点击勾选 / 取消 · 双击单张直接插入</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="np-grid">
            {rows.map((row) => (
              <LibThumb
                key={row.entry.path}
                row={row}
                selected={picked.includes(row.entry.path)}
                disabled={!picked.includes(row.entry.path) && full}
                onToggle={() => toggle(row.entry.path)}
                onDouble={() => insertOne(row)}
              />
            ))}
          </div>
        )}

        <footer className="np-foot">
          <span className="np-foot-tip">
            {pickedRows.length > 0
              ? '点「插入正文」后，图片会落在正文光标所在的那一段'
              : '先勾选照片，再点右侧「插入正文」'}
          </span>
          <div className="np-foot-acts">
            <button type="button" className="ghost-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="primary-btn np-insert-btn"
              onClick={confirm}
              disabled={busy || pickedRows.length === 0}
            >
              {busy ? '插入中…' : `插入正文 ${pickedRows.length} 张`}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
