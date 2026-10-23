/**
 * 游记正文的「图文混排」表示
 * --------------------------------
 * 正文存的是纯文本，图片用一行占位标记 `{{图:图片id}}` 表示（id 由 imageStore 生成）。
 * 编辑器里在光标处插入这个标记，渲染时换成真正的图片 —— 文字和图片因此有先后顺序，
 * 而不是「文字一坨 + 底下配一排图」。
 *
 * 老游记的正文没有标记，parse 出来就是纯文字段，行为与以前完全一致，不需要迁移。
 */

export type NoteSegment = { type: 'text'; value: string } | { type: 'img'; id: string };

const TOKEN_RE = /\{\{图:([^}\s]+)\}\}/g;

/** 生成一张图的正文占位行 */
export function imgToken(id: string): string {
  return `{{图:${id}}}`;
}

/** 去掉占位标记，得到「纯文字」正文（列表摘要用） */
export function stripImgTokens(body: string): string {
  return body.replace(TOKEN_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** 把正文切成「文字段 / 图片」序列；文字段按空行拆成段落 */
export function parseNoteBody(body: string): NoteSegment[] {
  const out: NoteSegment[] = [];
  const pushText = (s: string) => {
    for (const part of s.split(/\n{2,}/)) {
      const t = part.replace(/^\n+|\n+$/g, '');
      if (t.trim()) out.push({ type: 'text', value: t });
    }
  };
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    pushText(body.slice(last, idx));
    out.push({ type: 'img', id: m[1] });
    last = idx + m[0].length;
  }
  pushText(body.slice(last));
  return out;
}
