import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, Ref } from 'react';
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
 * - 图片只存 `data-img` + `width`（显示宽度，src 是临时 blob:，序列化时被清洗掉）。
 *   插入时按原图自然尺寸（超过正文宽度才缩），之后可拖右下角手柄改大小，高度始终按比例。
 * - 字体走 `execCommand('fontName')`（styleWithCSS=false 时产出 `<font face>`，
 *   见 noteBody 的清洗白名单），不引入 contenteditable 之外的样式来源。
 * - 段落对齐走 `execCommand('justify*')`：Blink 不论 styleWithCSS 都产出
 *   `<p style="text-align:center">`，清洗时只放行「纯 text-align」并规范成无空格形，
 *   编辑当时也要 normalizeAlign 一遍，否则 CSS 的 [style*="text-align:center"]
 *   选择器命中不了（块级图片不会因为 text-align 自己挪窝，靠它 margin:auto）。
 * - 工具栏不挂 title 悬浮提示（手机上长按会弹系统浮层挡按钮），只留 aria-label。
 * - 粘贴一律按纯文本插入，避免把网页样式（字体、颜色、表格）带进来。
 */

/** 工具栏字体下拉：常见中文字体 + 几款常见西文字体，值即 CSS font-family */
const FONTS: { label: string; value: string }[] = [
  { label: '默认字体', value: 'system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  { label: '宋体', value: 'SimSun, STSong, 宋体, serif' },
  { label: '黑体', value: 'SimHei, STHeiti, 黑体, sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "PingFang SC", 微软雅黑, sans-serif' },
  { label: '楷体', value: 'KaiTi, STKaiti, 楷体, serif' },
  { label: '仿宋', value: 'FangSong, STFangsong, 仿宋, serif' },
  { label: '隶书', value: 'LiSu, 隶书, serif' },
  { label: '幼圆', value: 'YouYuan, 幼圆, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
];

/** 段落对齐按钮：图标是四条横线，按各自方向排布 */
const ALIGN_BTNS: { dir: AlignDir; label: string; cmd: string }[] = [
  { dir: 'left', label: '左对齐', cmd: 'justifyLeft' },
  { dir: 'center', label: '居中', cmd: 'justifyCenter' },
  { dir: 'right', label: '右对齐', cmd: 'justifyRight' },
  { dir: 'justify', label: '两端对齐', cmd: 'justifyFull' },
];

/** 命令 -> 落库的对齐值（left 是默认，一律按「无对齐」处理） */
const ALIGN_VALUE: Record<string, string> = {
  justifyLeft: '',
  justifyCenter: 'center',
  justifyRight: 'right',
  justifyFull: 'justify',
};

/** 能承载 text-align 的块级宿主（图片在段落里时，对齐整个段落） */
const ALIGN_HOSTS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'LI']);

type AlignDir = 'left' | 'center' | 'right' | 'justify';

function AlignIcon({ dir }: { dir: AlignDir }) {
  // 四条线：前三条长短不一，两端对齐则全部拉满（左右都顶到边）
  const lens = dir === 'justify' ? [15, 15, 15, 15] : [15, 10, 13, 8];
  const xs = lens.map((w) => (dir === 'left' ? 1.5 : dir === 'center' ? (18 - w) / 2 : dir === 'right' ? 16.5 - w : 1.5));
  return (
    <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true" focusable="false">
      {[3, 7, 11, 15].map((y, i) => (
        <line key={y} x1={xs[i]} x2={xs[i] + lens[i]} y1={y} y2={y} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** 取字体族第一个名字，用于把 queryCommandValue 的结果对回下拉选项 */
function fontKey(v: string): string {
  return v.split(',')[0].trim().replace(/["']/g, '').toLowerCase();
}

export interface RichInsert {
  id: string;
  /** 已解析好的显示地址（可选；没有时等 urls 更新后自动补上） */
  url?: string;
}

export interface NoteRichEditorHandle {
  insertImages: (items: RichInsert[]) => void;
  focus: () => void;
  /** 收起键盘：打开选图面板前调用，否则键盘一直浮在面板后面 */
  blur: () => void;
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
  const [fmt, setFmt] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ul: false,
    ol: false,
    block: '',
    font: '',
    /** 当前段落对齐：'' 表示选区跨多种对齐（不高亮任何一个） */
    align: '' as AlignDir | '',
  });
  /** 当前点中的图片：浮出删除钮 + 右下角缩放手柄 */
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const [imgBox, setImgBox] = useState<{ top: number; left: number; w: number; h: number } | null>(null);
  /** 缩放手柄的拖动状态（pointer capture 在柄上，移动/抬起都走柄自身的事件） */
  const dragRef = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);

  /** 正文可用宽度（去掉左右内边距）：图片插入 / 缩大的上限 */
  const contentWidth = () => {
    const el = bodyRef.current;
    if (!el) return 320;
    const cs = getComputedStyle(el);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(80, el.clientWidth - pad);
  };

  const syncImgBox = (img: HTMLImageElement) => {
    setImgBox({ top: img.offsetTop, left: img.offsetLeft, w: img.offsetWidth, h: img.offsetHeight });
  };

  /** 把图片摆到「原图尺寸」：超过正文宽度才缩；同时刷新选中框位置 */
  const fitImage = (img: HTMLImageElement) => {
    const apply = () => {
      const nat = img.naturalWidth || 0;
      if (nat <= 0) return;
      // 注意：不能写 `if (img.width !== w)` —— 没有 width 属性时 img.width 读的是
      // 「渲染宽度」，原尺寸恰好等于渲染宽时会被跳过，属性永远写不上。
      img.width = Math.max(48, Math.min(nat, contentWidth()));
      if (imgElRef.current === img) syncImgBox(img);
    };
    if (img.complete && img.naturalWidth > 0) apply();
    else if (img.dataset.fitted !== '1') {
      img.dataset.fitted = '1';
      img.addEventListener('load', apply, { once: true });
    }
  };

  /**
   * 把编辑器里所有 style 规范成 `text-align:<值>`（浏览器产出的是 `text-align: center;`
   * 带空格带分号）。不清成规范形，CSS 的 [style*="text-align:center"] 选择器就命中不了，
   * 「段落居中了但块级图片不动」。在 exec 之后 / hydrate 时调用。
   * text-align:left 是默认对齐，和清洗器一样按「无对齐」去掉，库里不留噪音。
   */
  const normalizeAlign = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
      const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(el.getAttribute('style') ?? '');
      if (m && m[1].toLowerCase() !== 'left') el.setAttribute('style', `text-align:${m[1].toLowerCase()}`);
      else el.removeAttribute('style');
    });
  };

  const hydrate = (root: HTMLElement) => {
    root.querySelectorAll<HTMLImageElement>('img[data-img]').forEach((img) => {
      const id = img.dataset.img ?? '';
      const url = urlsRef.current[id];
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
      // 老游记里的图没有 width：按原图尺寸补一次（只改显示，不影响已存内容）
      if (!img.getAttribute('width')) fitImage(img);
    });
    normalizeAlign(root);
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

  /**
   * 光标处（选区起点）的字体。编辑器只产出 `<font face>`（styleWithCSS=false），
   * 所以从起点往上找最近的 font 即可 —— 比 queryCommandValue('fontName') 可靠：
   * 后者在选区里混有图片 / 多个块时会返回空值或串值，下拉框会错显示「默认字体」。
   */
  const fontAtCaret = (): string => {
    const el = bodyRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return '';
    const r = sel.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return '';
    let cur: HTMLElement | null =
      r.startContainer.nodeType === 1 ? (r.startContainer as HTMLElement) : r.startContainer.parentElement;
    while (cur && cur !== el) {
      if (cur.tagName === 'FONT') return cur.getAttribute('face') ?? '';
      cur = cur.parentElement;
    }
    return '';
  };

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
          font: fontAtCaret(),
          // 四个状态互斥（left 是默认兜底）：先判特殊三种，再落回 left
          align: document.queryCommandState('justifyCenter')
            ? 'center'
            : document.queryCommandState('justifyRight')
              ? 'right'
              : document.queryCommandState('justifyFull')
                ? 'justify'
                : document.queryCommandState('justifyLeft')
                  ? 'left'
                  : '',
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
    // 对齐命令刚产出的 style 带空格（"text-align: center;"），规范掉再让 CSS 选择器命中
    const el = bodyRef.current;
    if (el) normalizeAlign(el);
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

  /**
   * 段落对齐。和普通 exec 的区别：用户点过图片时，先把 DOM 选区钉到图片节点上。
   * 不钉的话 Blink 的落点会漂（有时把 text-align 写到旁边空段落上，图片自己不动），
   * 而且我们的图是 display:block，Blink 会把样式直接写在 <img> 身上——对块级图
   * 毫无视觉效果。所以命令跑完后按「点的哪个对齐」把最终状态确定性地写到目标上：
   * 图在段落里 → 写段落（文字和图一起对齐）；图是顶层块 → 写图自己（CSS 认）。
   */
  const execAlign = (cmd: string) => {
    const img = imgElRef.current;
    const el = bodyRef.current;
    if (img && img.isConnected && el) {
      const sel = window.getSelection();
      if (sel) {
        const r = document.createRange();
        r.selectNode(img);
        sel.removeAllRanges();
        sel.addRange(r);
        lastRangeRef.current = r.cloneRange();
      }
    }
    exec(cmd);
    if (!img || !img.isConnected) return;

    const a = ALIGN_VALUE[cmd] ?? '';
    const host = img.parentElement;
    const target = host && host !== el && ALIGN_HOSTS.has(host.tagName) ? host : img;
    if (a) target.setAttribute('style', `text-align:${a}`);
    else target.removeAttribute('style');
    // 宿主是段落时，图自己不留样式（避免和段落样式打架，也少一份噪音）
    if (target !== img) img.removeAttribute('style');
    // Blink 的副作用：对齐顶层图时，紧挨着的空段落也会被写上同样的 text-align。
    // 空段落没有可对齐的内容，纯噪音（还会被清洗器当排版意图存进库），清掉。
    for (const sib of [img.previousElementSibling, img.nextElementSibling]) {
      if (
        sib &&
        sib.tagName === 'P' &&
        sib.getAttribute('style') &&
        !(sib.textContent ?? '').trim() &&
        !sib.querySelector('img')
      ) {
        sib.removeAttribute('style');
      }
    }
    syncImgBox(img); // 图挪了位置，选中框 / 手柄跟着走
    // exec() 里已经 emit 过一次，但那是在清理之前：补发一次，
    // 让 React 里的正文（保存时就存它）也是清理后的干净版本
    emit();
  };

  const makeImg = (item: RichInsert): HTMLImageElement => {
    const img = document.createElement('img');
    img.setAttribute('data-img', item.id);
    img.alt = '';
    // contenteditable 里 img 默认可拖拽：手机上长按一晃就把图拖到别处，关掉
    img.draggable = false;
    const url = item.url ?? urlsRef.current[item.id];
    if (url) img.setAttribute('src', url);
    return img;
  };

  const insertImages = (items: RichInsert[]) => {
    const el = bodyRef.current;
    if (!el || items.length === 0) return;
    // 选图面板是「失焦 → 挑图 → 插回光标处」：从面板回来时编辑器并没有焦点，
    // 为了能 execCommand 必须临时聚焦，插完立刻 blur 把键盘收掉
    // （否则手机上选一张图、键盘弹一次，很吵）。
    const wasFocused = document.activeElement === el;
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
      // 原图尺寸进正文：宽超过正文才缩，高度按比例自动算
      fitImage(img);
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
    if (!wasFocused) el.blur();
  };

  useImperativeHandle(ref, () => {
    const api: NoteRichEditorHandle = {
      insertImages,
      focus: () => {
        restore();
      },
      blur: () => {
        bodyRef.current?.blur();
      },
    };
    // 开发模式下暴露给无头回归脚本（prod 打包时该分支被静态剔除）
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __noteEditor?: NoteRichEditorHandle }).__noteEditor = api;
    }
    return api;
  });

  const selectImg = (img: HTMLImageElement | null) => {
    // 换选中图：先把上一张的选中描边去掉
    if (imgElRef.current && imgElRef.current !== img) imgElRef.current.classList.remove('is-sel');
    imgElRef.current = img;
    if (img) {
      img.classList.add('is-sel');
      syncImgBox(img);
    } else {
      setImgBox(null);
    }
  };

  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'IMG' && (t as HTMLImageElement).dataset.img) {
      selectImg(t as HTMLImageElement);
    } else {
      selectImg(null);
    }
  };

  const removeImg = () => {
    const img = imgElRef.current;
    if (!img) return;
    img.remove();
    imgElRef.current = null;
    setImgBox(null);
    emit();
  };

  /* ---------- 图片缩放：拖右下角手柄改宽度，高度按比例跟随 ---------- */
  const onResizeStart = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const img = imgElRef.current;
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    // 起点取渲染宽度（offsetWidth 含边框，与 width 属性在 border-box 下一致）：
    // 这样拖动delta 就是屏幕上看到的像素变化
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startW: img.offsetWidth || 200 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = dragRef.current;
    const img = imgElRef.current;
    if (!d || !img || d.pointerId !== e.pointerId) return;
    e.preventDefault();
    // 只改 width 属性：CSS height:auto 会按原图比例算高度，不会拉变形
    const w = Math.max(48, Math.min(contentWidth(), Math.round(d.startW + (e.clientX - d.startX))));
    img.width = w;
    syncImgBox(img);
  };

  const onResizeEnd = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    emit(); // 落库这次改的宽度
  };

  const btn = (
    label: string,
    cmd: string,
    opts?: { on?: boolean; value?: string; cls?: string },
  ) => (
    <button
      type="button"
      className={`rt-btn${opts?.on ? ' is-on' : ''}${opts?.cls ? ` ${opts.cls}` : ''}`}
      // 用 mousedown 拦掉默认行为，否则点按钮会先夺走编辑器焦点、丢失选区
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(cmd, opts?.value)}
    >
      {label}
    </button>
  );

  return (
    <div className="rt-wrap">
      {/* 工具栏不挂 title 悬浮提示：手机上没有 hover，长按还会弹系统浮层挡按钮 */}
      <div className="rt-toolbar">
        <button
          type="button"
          className={`rt-btn${fmt.bold ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('bold')}
          aria-label="加粗"
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.italic ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('italic')}
          aria-label="斜体"
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.underline ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('underline')}
          aria-label="下划线"
        >
          <u>U</u>
        </button>
        <span className="rt-sep" />
        <button
          type="button"
          className={`rt-btn${fmt.block === 'h2' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('h2')}
        >
          标题
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.block === 'h3' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('h3')}
        >
          小标题
        </button>
        <button
          type="button"
          className={`rt-btn${fmt.block === 'blockquote' ? ' is-on' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleBlock('blockquote')}
        >
          引用
        </button>
        <span className="rt-sep" />
        {btn('• 列表', 'insertUnorderedList', { on: fmt.ul })}
        {btn('1. 列表', 'insertOrderedList', { on: fmt.ol })}
        <span className="rt-sep" />
        {ALIGN_BTNS.map((a) => (
          <button
            key={a.dir}
            type="button"
            className={`rt-btn rt-btn--ico${fmt.align === a.dir ? ' is-on' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => execAlign(a.cmd)}
            aria-label={a.label}
          >
            <AlignIcon dir={a.dir} />
          </button>
        ))}
        <span className="rt-sep" />
        <select
          className="rt-font"
          value={FONTS.find((f) => fontKey(f.value) === fontKey(fmt.font))?.value ?? FONTS[0].value}
          onChange={(e) => exec('fontName', e.target.value)}
          aria-label="正文字体"
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="rt-sep" />
        <button
          type="button"
          className="rt-btn rt-btn--img"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onPickImage}
          disabled={imageFull}
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

      {imgBox && imgElRef.current && (
        <>
          {/* 删除钮：图片右上角 */}
          <button
            type="button"
            className="rt-img-del"
            style={{ top: imgBox.top + 8, left: Math.max(8, imgBox.left + imgBox.w - 42) }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={removeImg}
            aria-label="删除这张图片"
          >
            ×
          </button>
          {/* 缩放手柄：图片右下角，左右拖动改宽度（高度按比例） */}
          <span
            className="rt-img-resize"
            role="slider"
            aria-label="拖动调整图片大小"
            aria-valuenow={imgBox.w}
            style={{ top: imgBox.top + imgBox.h - 13, left: imgBox.left + imgBox.w - 13 }}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onPointerCancel={onResizeEnd}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M1 11 L11 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
              <path d="M5 1 h6 v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </span>
        </>
      )}
    </div>
  );
}
