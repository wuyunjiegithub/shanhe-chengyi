import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, Ref } from 'react';
import { sanitizeNoteHtml } from '../../data/noteBody';

/**
 * 游记富文本编辑器（contenteditable，所见即所得）
 * --------------------------------------------------
 * 为什么不用「左编辑 + 右预览」：写游记时文字和图片是混着来的，
 * 拆成两栏会让人反复上下对照，正文一长就没法写了。这里直接在一处写：
 * 加粗/标题/引用/列表/图片全部即时生效，不留第二块预览区。
 *
 * 实现要点：
 * - **不要用 React 管 contenteditable 的内容**。只在挂载时写一次 innerHTML，
 *   之后 DOM 由浏览器维护；每次输入只「读出 HTML 上报」，绝不回写，
 *   否则光标会在每次按键后跳到开头。
 * - 图片只存 `data-img`（src 是临时 blob:，由 hydrate 注入，序列化时被清洗掉）。
 * - 粘贴一律按纯文本插入，避免把网页样式（字体、颜色、表格）带进来。
 */

export interface RichInsert {
  id: string;
  /** 已解析好的显示地址（可选；没有时等 urls 更新后自动补上） */
  url?: string;
}

export interface NoteRichEditorHandle {
  insertImages: (items: RichInsert[]) => void;
  focus: () => void;
}

interface NoteRichEditorProps {
  ref?: Ref<NoteRichEditorHandle>;
  /** 初始 HTML（只用于首次挂载） */
  html: string;
  /** 图片 id -> object URL */
  urls: Record<string, string>;
  onChange: (html: string) => void;
  onPickImage: () => void;
  /** 图片已达上限时禁用「插入图片」 */
  imageFull: boolean;
  placeholder?: string;
}

function isEmptyEl(el: HTMLElement): boolean {
  if (el.querySelector('img[data-img]')) return false;
  return (el.textContent ?? '').replace(/\u200b/g, '').trim() === '';
}

export function NoteRichEditor({
  ref,
  html,
  urls,
  onChange,
  onPickImage,
  imageFull,
  placeholder = '正文：走了哪些地方、吃了什么、遇见什么人……',
}: NoteRichEditorProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  /** 最后一次落在编辑器里的选区：点工具栏/选图会移动焦点，插入时用它复原 */
  const lastRangeRef = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(!html.trim());
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, block: '' });
  /** 当前点中的图片（用于浮出的删除钮） */
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const [imgPos, setImgPos] = useState<{ top: number; left: number } | null>(null);

  const hydrate = (root: HTMLElement) => {
    root.querySelectorAll<HTMLImageElement>('img[data-img]').forEach((img) => {
      const id = img.dataset.img ?? '';
      const url = urlsRef.current[id];
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
    });
  };

  const emit = () => {
    const el = bodyRef.current;
    if (!el) return;
    setEmpty(isEmptyEl(el));
    onChange(sanitizeNoteHtml(el.innerHTML));
  };

  /* 挂载：注入初始 HTML + 设定编辑器的段落行为（只做一次） */
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.innerHTML = sanitizeNoteHtml(html);
    try {
      // 让加粗产出 <b> 而不是 style="font-weight:700"，清洗时才留得住
      document.execCommand('styleWithCSS', false, 'false');
      // Enter 新建 <p>（默认在部分 webview 里是 <div>）
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* 老 webview 不支持就按浏览器默认来 */
    }
    hydrate(el);
    setEmpty(isEmptyEl(el));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* urls 补齐（新插入的图 / 异步读库）后把 src 填上 */
  useEffect(() => {
    const el = bodyRef.current;
    if (el) hydrate(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls]);

  /* 选区变化：同步按钮高亮 + 记住位置 */
  useEffect(() => {
    const onSel = () => {
      const el = bodyRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.commonAncestorContainer)) return;
      lastRangeRef.current = r.cloneRange();
      try {
        setFmt({
          bold: document.queryCommandState('bold'),
          italic: document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
          ul: document.queryCommandState('insertUnorderedList'),
          ol: document.queryCommandState('insertOrderedList'),
          block: String(document.queryCommandValue('formatBlock') ?? '').toLowerCase(),
        });
      } catch {
        /* 个别环境不实现 queryCommand*，忽略高亮即可 */
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  /** 复原到编辑器内的最后一次选区，再执行命令 */
  const restore = () => {
    const el = bodyRef.current;
    if (!el) return null;
    el.focus();
    const sel = window.getSelection();
    const r = lastRangeRef.current;
    if (sel && r && el.contains(r.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return el;
  };

  const exec = (cmd: string, value?: string) => {
    restore();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* 忽略：命令不被支持时不影响继续写 */
    }
    emit();
    // 命令后光标位置变了，重新记一次
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) lastRangeRef.current = sel.getRangeAt(0).cloneRange();
  };

  /** 标题 / 引用：已经是该块级格式就退回普通段落 */
  const toggleBlock = (tag: 'h2' | 'h3' | 'blockquote') => {
    const cur = fmt.block.replace(/[<>]/g, '');
    exec('formatBlock', cur === tag ? 'p' : tag);
  };

  const makeImg = (item: RichInsert): HTMLImageElement => {
    const img = document.createElement('img');
    img.setAttribute('data-img', item.id);
    img.alt = '';
    const url = item.url ?? urlsRef.current[item.id];
    if (url) img.setAttribute('src', url);
    return img;
  };

  const insertImages = (items: RichInsert[]) => {
    const el = bodyRef.current;
    if (!el || items.length === 0) return;
    const box = restore();
    if (!box) return;
    const sel = window.getSelection();
    let range: Range | null = lastRangeRef.current;
    if (!range || !box.contains(range.startContainer)) range = null;

    // 落点后跟一个空段落，插完图光标停在那儿可以接着写
    const anchor = document.createElement('p');
    anchor.appendChild(document.createElement('br'));
    if (range) {
      range.deleteContents();
      range.insertNode(anchor);
    } else {
      box.appendChild(anchor);
    }
    for (const item of items) {
      const img = makeImg(item);
      anchor.parentNode?.insertBefore(img, anchor);
    }
    if (sel) {
      const r = document.createRange();
      r.setStart(anchor, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      lastRangeRef.current = r.cloneRange();
    }
    emit();
  };

  useImperativeHandle(ref, () => {
    const api: NoteRichEditorHandle = {
      insertImages,
      focus: () => {
        restore();
      },
    };
    // 开发模式下暴露给无头回归脚本（prod 打包时该分支被静态剔除）
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __noteEditor?: NoteRichEditorHandle }).__noteEditor = api;
    }
    return api;
  });

  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG' && (t as HTMLImageElement).dataset.img) {
      const img = t as HTMLImageElement;
      imgElRef.current = img;
      setImgPos({ top: img.offsetTop + 8, left: Math.max(8, img.offsetLeft + img.offsetWidth - 42) });
    } else {
      imgElRef.current = null;
      setImgPos(null);
    }
  };

  const removeImg = () => {
    const img = imgElRef.current;
    if (!img) return;
    img.remove();
    imgElRef.current = null;
    setImgPos(null);
    emit();
  };

  const btn = (
    label: string,
    cmd: string,
    opts?: { on?: boolean; title?: string; value?: string; cls?: string },
  ) => (
    <button
      type="button"
      className={`rt-btn${opts?.on ? ' is-on' : ''}${opts?.cls ? ` ${opts.cls}` : ''}`}
      // 用 mousedown 拦掉默认行为，否则点按钮会先夺走编辑器焦点、丢失选区
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(cmd, opts?.value)}
      title={opts?.title ?? label}
    >
      {label}
    </button>
  );

  return (
    <div className="rt-wrap">
      <div className="rt-toolbar">
        <button
          type="button"
          className={`rt-btn${fmt.bold ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
          title="加粗（Ctrl+B）"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.italic ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
          title="斜体（Ctrl+I）"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.underline ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
          title="下划线"
        >
          <u>U</u>
        </button>
        <span className="rt-sep" />
        <button
          type="button"
          className={`rt-btn${fmt.block === 'h2' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('h2')}
          title="大标题"
        >
          标题
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.block === 'h3' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('h3')}
          title="小标题"
        >
          小标题
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.block === 'blockquote' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('blockquote')}
          title="引用 / 摘句"
        >
          引用
        </button>
        <span className="rt-sep" />
        {btn('• 列表', 'insertUnorderedList', { on: fmt.ul, title: '无序列表' })}
        {btn('1. 列表', 'insertOrderedList', { on: fmt.ol, title: '有序列表' })}
        <span className="rt-sep" />
        <button
          type="button"
          className="rt-btn rt-btn--img"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPickImage}
          disabled={imageFull}
          title={imageFull ? '图片已达上限' : '从照片库插入图片到光标处'}
        >
          ＋ 图片
        </button>
      </div>

      <div
        ref={bodyRef}
        className={`rt-body${empty ? ' is-empty' : ''}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-ph={placeholder}
        onInput={emit}
        onBlur={(e) => {
          // 失焦时如果是空编辑器，浏览器可能留下 <br>，清掉才能显示占位提示。
          // 注意：不要把 lastRangeRef 清空 —— 点下方「插入照片」按钮会先失焦，
          // 图片仍然要插在刚才的光标处。
          const el = e.currentTarget;
          if (isEmptyEl(el) && el.innerHTML !== '') {
            el.innerHTML = '';
            setEmpty(true);
            onChange('');
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text/plain');
          if (!text) return;
          e.preventDefault();
          document.execCommand('insertText', false, text);
          emit();
        }}
        onClick={onClick}
      />

      {imgPos && (
        <button
          type="button"
          className="rt-img-del"
          style={{ top: imgPos.top, left: imgPos.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={removeImg}
          title="删除这张图片"
        >
          ×
        </button>
      )}
    </div>
  );
}
