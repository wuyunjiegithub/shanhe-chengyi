import { useMemo } from 'react';
import { parseNoteBody } from '../../data/noteBody';

/**
 * 按正文顺序渲染「文字段 + 图片」：占位标记 `{{图:id}}` 换成图片本身。
 * 保存后的游记、编辑器里的「正文效果」都用它，保证所见即所得。
 */
export function NoteBodyView({
  body,
  urls,
  emptyHint = '正文还是空的',
}: {
  body: string;
  /** 图片 id -> 可显示 URL（由调用方解析好） */
  urls: Record<string, string>;
  emptyHint?: string;
}) {
  const segs = useMemo(() => parseNoteBody(body), [body]);
  if (segs.length === 0) return <p className="note-body-empty">{emptyHint}</p>;

  return (
    <div className="note-body-view">
      {segs.map((s, i) =>
        s.type === 'img' ? (
          <figure key={`img-${i}`} className="note-body-figure">
            {urls[s.id] ? (
              <img src={urls[s.id]} alt="" loading="lazy" />
            ) : (
              <span className="note-body-fig-ph">图片加载中…</span>
            )}
          </figure>
        ) : (
          <p key={`p-${i}`} className="note-body-para">
            {s.value}
          </p>
        ),
      )}
    </div>
  );
}
