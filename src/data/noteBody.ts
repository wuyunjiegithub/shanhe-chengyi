/**
 * 游记正文的存储格式与转换
 * --------------------------------
 * **v2（现在）**：正文存富文本 HTML。图片写成 `<img data-img="图片id" alt="">`，
 *   - 图片字节仍然存在 IndexedDB（见 imageStore），HTML 里只留 id；
 *   - 不把 `src` 存进去，因为 blob: URL 跨会话/跨重启必然失效，
 *     打开编辑器时再按 id 重新注入（见 NoteRichEditor 的 hydrate）。
 *   这样正文可以加粗、标题、引用、列表、图文混排，而 localStorage 不会被图片撑爆。
 *
 * **v1（旧）**：纯文本 + 一行占位标记 `{{图:图片id}}`。
 *   读取时由 `toNoteHtml()` 自动转成 HTML，老游记不需要任何迁移动作；
 *   保存一次之后就变成 v2。
 */

export type NoteSegment = { type: 'text'; value: string } | { type: 'img'; id: string };

const TOKEN_RE = /\{\{图:([^}\s]+)\}\}/g;

/** 生成一张图的正文占位行（仅用于解析 / 兼容旧数据） */
export function imgToken(id: string): string {
  return `{{图:${id}}}`;
}

/** 把旧格式正文切成「文字段 / 图片」序列；文字段按空行拆开 */
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

/* ==================== v1 -> v2 迁移 ==================== */

/** 正文里是否已经出现 HTML 标签（用于区分 v1 纯文本与 v2 富文本） */
const HTML_TAG_RE = /<\/?(p|div|br|h[1-6]|ul|ol|li|blockquote|hr|img|b|strong|i|em|u|s|span|figure|a)\b[^>]*>/i;

export function looksLikeNoteHtml(body: string): boolean {
  return HTML_TAG_RE.test(body);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 旧纯文本 -> HTML：段落用 <p>，段内换行用 <br>（原来靠 pre-wrap 保留） */
export function legacyToHtml(text: string): string {
  const out: string[] = [];
  for (const seg of parseNoteBody(text)) {
    if (seg.type === 'img') {
      out.push(`<img data-img="${seg.id}" alt="">`);
      continue;
    }
    const inner = seg.value.split('\n').map((line) => esc(line.replace(/\s+$/, ''))).join('<br>');
    out.push(`<p>${inner || '<br>'}</p>`);
  }
  return out.join('');
}

/* ==================== 清洗 ==================== */

/**
 * 只放行编辑器会产出的标签 / 属性：
 * - 未知标签（如 span/font/section）就地「拆壳」保留文字，不整段丢；
 * - script/style/iframe 这类连内容一起丢掉；
 * - img 只留 data-img（src 是临时的 blob:，不入库），没有 data-img 的外链图一律丢弃；
 * - 事件属性、class、style 全部剥掉，避免 localStorage 里的脏数据被 innerHTML 执行。
 */
const ALLOWED_TAGS = new Set([
  'P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'MARK', 'CODE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'IMG', 'FIGURE', 'FIGCAPTION', 'A',
]);
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH',
  'FORM', 'INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'VIDEO', 'AUDIO', 'CANVAS',
]);
const ALLOWED_ATTRS: Record<string, string[]> = {
  IMG: ['data-img', 'alt'],
  A: ['href'],
};
const IMG_ID_RE = /^[A-Za-z0-9_-]+$/;

export function sanitizeNoteHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body><div id="__r">${html}</div></body>`, 'text/html');
  const root = doc.getElementById('__r');
  if (!root) return '';

  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName;
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const parent = el.parentNode;
      if (!parent) continue;
      // 拆壳：把子节点提到父级，保留文字
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      continue;
    }
    const keep = ALLOWED_ATTRS[tag] ?? [];
    for (const attr of Array.from(el.attributes)) {
      if (!keep.includes(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
    if (tag === 'IMG') {
      const id = el.getAttribute('data-img') ?? '';
      if (!IMG_ID_RE.test(id)) {
        el.remove();
        continue;
      }
    }
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (!/^https?:\/\//i.test(href)) el.removeAttribute('href');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  }

  /* 结构性清洗：contenteditable 会留下不少空壳，存进去越积越多 */
  for (const el of Array.from(root.querySelectorAll('b, strong, i, em, u, s, strike, span, a'))) {
    if (!el.parentNode) continue;
    const hasText = (el.textContent ?? '').trim() !== '';
    const img = el.querySelector('img[data-img]');
    // 空的加粗/斜体壳（删字后残留、或 Chromium 造的「加粗空行」）直接去掉
    if (!hasText && !img) {
      el.remove();
      continue;
    }
    // 只包着一张图的内联壳：拆掉，别让图片继承加粗 / 斜体
    if (el.childNodes.length === 1 && el.firstChild?.nodeName === 'IMG') {
      el.parentNode.insertBefore(el.firstChild, el);
      el.parentNode.removeChild(el);
    }
  }
  // 彻底的空白段落（没有字、没有图、没有换行）
  for (const el of Array.from(root.querySelectorAll('p, div'))) {
    if (el.children.length === 0 && (el.textContent ?? '').trim() === '') el.remove();
  }
  return root.innerHTML;
}

/** 任意来源（旧纯文本 / 富文本）-> 可存可编辑的 HTML */
export function toNoteHtml(body: string): string {
  const raw = (body ?? '').trim();
  if (!raw) return '';
  return looksLikeNoteHtml(raw) ? sanitizeNoteHtml(raw) : legacyToHtml(raw);
}

/* ==================== 读取 ==================== */

/** 正文里引用的图片 id（按出现顺序去重）——笔记的 images 列表由它推导 */
export function noteImageIds(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/data-img="([A-Za-z0-9_-]+)"/g)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 去掉标签，得到纯文字（列表摘要 / 判空用）。旧格式的 `{{图:id}}` 也一并去掉 */
export function noteHtmlToPlain(html: string): string {
  if (!html) return '';
  const withBreaks = html
    .replace(/\{\{图:[^}\s]+\}\}/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure|figcaption)>/gi, ' ');
  if (typeof DOMParser === 'undefined') {
    return withBreaks.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  const doc = new DOMParser().parseFromString(`<body><div id="__t">${withBreaks}</div></body>`, 'text/html');
  const root = doc.getElementById('__t');
  return (root?.textContent ?? '').replace(/\s{2,}/g, ' ').trim();
}
