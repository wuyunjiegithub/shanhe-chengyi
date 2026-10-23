// v0.9.16 富文本编辑器核查：
// ① 段落对齐四按钮（左 / 居中 / 右 / 两端）——命令生效、高亮互斥、状态可回显
// ② 块级图片跟随段落对齐（居中的段里的图真的居中，不是只对齐文字）
// ③ 对齐经保存 / 重开不丢（清洗器放行「纯 text-align」style，且规范成无空格形）
// ④ 清洗器挡掉混装 style（color:red;text-align:center 整条丢掉）与事件属性
// ⑤ 编辑区不再有任何「操作按钮提示」：工具栏无 title、无 .rt-tip 行、占位符不提工具栏
//
// 手机端用 Android UA + 桩版 __TAURI_INTERNALS__ 模拟套壳环境。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import path from 'node:path';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

// 图片用 canvas 在页面里现画成 data URL（手写 base64 容易写出损坏的 PNG，
// 损坏图 load 后 naturalWidth=0，会把「图没插进去」误报成超时）

// 桩：整个函数体会被序列化进页面，不能依赖外部闭包变量
const stub = () => {
  const pngUrl = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f43f5e');
    g.addColorStop(1, '#0ea5e9');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c.toDataURL('image/png');
  };
  const urlToBytes = (url) => {
    const bin = atob(url.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  const photos = [
    { id: 11, bucket: '淳安县', name: '小图.jpg', path: '/DCIM/Camera/a.jpg', uri: 'content://media/external/images/media/11', mtime: 1700000000000, width: 240, height: 320, mime: 'image/jpeg' },
  ];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'media_permission_state': return true;
        case 'media_request_permission': return true;
        case 'media_list_albums': return [{ name: '淳安县', count: 1 }];
        case 'media_all_photos': return photos;
        case 'media_album_photos': return photos.filter((p) => p.bucket === args?.album);
        case 'media_photo_bytes': return urlToBytes(pngUrl(240, 320));
        case 'plugin:app|registerListener': return 0;
        default: throw new Error(`unstubbed invoke: ${cmd}`);
      }
    },
    convertFileSrc: () => pngUrl(240, 320),
  };
};

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA_ANDROID,
});
await page.addInitScript(stub);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errs.push('console: ' + msg.text().slice(0, 160));
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3200);

/* ---------- 打开淳安县的游记编辑器（新游记） ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(500);

/* ---------- ⑤ 编辑区不再有「操作按钮提示」 ---------- */
const hints = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  return {
    titled: tb ? tb.querySelectorAll('[title]').length : -1,
    tipCount: document.querySelectorAll('.rt-tip').length,
    placeholder: document.querySelector('.rt-body')?.getAttribute('data-ph') ?? '',
    alignLabels: [...(tb?.querySelectorAll('.rt-btn--ico') ?? [])].map((b) => b.getAttribute('aria-label')),
  };
});
rec('⑤ 工具栏按钮 / 下拉不再挂 title 悬浮提示', hints.titled === 0, `title 属性数=${hints.titled}`);
rec('⑤ 编辑器下方不再有 .rt-tip 提示行', hints.tipCount === 0, `.rt-tip 数=${hints.tipCount}`);
rec('⑤ 占位符不再讲解工具栏用法', !/工具栏/.test(hints.placeholder), JSON.stringify(hints.placeholder));
rec('① 工具栏有四枚对齐图标钮（左/居中/右/两端）',
  JSON.stringify(hints.alignLabels) === JSON.stringify(['左对齐', '居中', '右对齐', '两端对齐']),
  JSON.stringify(hints.alignLabels));

/* ---------- ① 文字段落：四种对齐轮着来 ---------- */
await page.click('.rt-body');
await page.keyboard.type('傍晚的黄浦江');
await page.waitForTimeout(200);

const clickAlign = async (label) => {
  await page.click(`.rt-btn--ico[aria-label="${label}"]`);
  await page.waitForTimeout(260);
};

const readFmt = () =>
  page.evaluate(() => {
    const body = document.querySelector('.rt-body');
    const p = body.querySelector('p');
    return {
      style: p?.getAttribute('style') ?? '',
      states: {
        left: document.queryCommandState('justifyLeft'),
        center: document.queryCommandState('justifyCenter'),
        right: document.queryCommandState('justifyRight'),
        full: document.queryCommandState('justifyFull'),
      },
      onBtns: [...document.querySelectorAll('.rt-btn--ico.is-on')].map((b) => b.getAttribute('aria-label')),
    };
  });

await clickAlign('居中');
let f = await readFmt();
console.log('  居中后:', JSON.stringify(f));
rec('① 居中：段落产出 style="text-align:center"', f.style === 'text-align:center', f.style);
rec('① 居中：按钮高亮且只亮一个', JSON.stringify(f.onBtns) === JSON.stringify(['居中']), JSON.stringify(f.onBtns));
rec('① 居中：queryCommandState 互斥（仅 center 为真）',
  f.states.center && !f.states.left && !f.states.right && !f.states.full, JSON.stringify(f.states));

await clickAlign('右对齐');
f = await readFmt();
console.log('  右对齐后:', JSON.stringify(f));
rec('① 右对齐：style="text-align:right" 且高亮转移', f.style === 'text-align:right' && JSON.stringify(f.onBtns) === JSON.stringify(['右对齐']), `${f.style} ${JSON.stringify(f.onBtns)}`);

await clickAlign('两端对齐');
f = await readFmt();
console.log('  两端对齐后:', JSON.stringify(f));
rec('① 两端对齐：style="text-align:justify" 且高亮转移', f.style === 'text-align:justify' && JSON.stringify(f.onBtns) === JSON.stringify(['两端对齐']), `${f.style} ${JSON.stringify(f.onBtns)}`);

await clickAlign('左对齐');
f = await readFmt();
console.log('  左对齐后:', JSON.stringify(f));
rec('① 左对齐：text-align:left 是默认，style 移除', f.style === '', f.style);
rec('① 左对齐：高亮落在左对齐钮上', JSON.stringify(f.onBtns) === JSON.stringify(['左对齐']), JSON.stringify(f.onBtns));

/* ---------- ② 图片跟随段落对齐 ---------- */
// 先把光标移到正文末尾（容器是 .rt-body 本身，图才会作为顶层块插入，
// 而不是嵌进上面那段文字里——嵌进去对齐就落到文字段上了）
await page.evaluate(() => {
  const el = document.querySelector('.rt-body');
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
// 走编辑器句柄插一张 200×120 的图（canvas 现画 data URL，不依赖相册桥）
await page.evaluate(() => {
  const handle = window.__noteEditor;
  if (!handle) throw new Error('window.__noteEditor 未暴露（仅 DEV）');
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = '#f43f5e';
  x.fillRect(0, 0, 200, 120);
  handle.insertImages([{ id: 'v16img', url: c.toDataURL('image/png') }]);
});
await page.waitForFunction(
  () => {
    const imgs = document.querySelectorAll('.rt-body img[data-img]');
    return imgs.length === 1 && imgs[0].complete && imgs[0].naturalWidth > 0;
  },
  { timeout: 15000 },
);
await page.waitForTimeout(250);

// 点选图片（真实手势：单击图 → 选中态），再把 DOM 选区钉到图片节点上，
// 这样「居中」命令的落点就是这张图（Blink 会把它包进居中的 <p>）
await page.click('.rt-body img[data-img]');
await page.waitForTimeout(150);
await page.evaluate(() => {
  const img = document.querySelector('.rt-body img[data-img]');
  const r = document.createRange();
  r.selectNode(img);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.waitForTimeout(150);
await clickAlign('居中');

const imgAlign = await page.evaluate(() => {
  const img = document.querySelector('.rt-body img[data-img]');
  const p = img?.parentElement;
  const ir = img?.getBoundingClientRect();
  const pr = p?.getBoundingClientRect();
  return {
    // 顶层图：对齐样式写在 <img> 自己身上（Blink 对 display:block 的图就这么干），
    // CSS 再用 margin 把它推到对应一侧
    imgStyle: img?.getAttribute('style') ?? '',
    // 旁边那个空段落不该被 Blink 的副作用写上样式
    strayP: [...document.querySelectorAll('.rt-body > p')].filter((x) => x.getAttribute('style') && !(x.textContent ?? '').trim()).length,
    centerDelta: ir && pr ? Math.abs((ir.left + ir.right) / 2 - (pr.left + pr.right) / 2) : 999,
    imgW: ir ? Math.round(ir.width) : 0,
  };
});
console.log('  图片居中后:', JSON.stringify(imgAlign));
rec('② 选图点居中：图片自身带上 text-align:center',
  imgAlign.imgStyle === 'text-align:center', imgAlign.imgStyle);
rec('② 旁边空段落不被写上对齐样式（Blink 副作用已清）', imgAlign.strayP === 0, `stray=${imgAlign.strayP}`);
rec('② 块级图片真正水平居中（不只是文字对齐）', imgAlign.centerDelta <= 2, `中心差=${imgAlign.centerDelta}px`);

/* ---------- ③ 保存 / 重开：对齐不丢 ---------- */
await page.click('.note-editor-head .primary-btn');
await page.waitForSelector('.note-list', { timeout: 6000 });
await page.waitForTimeout(400);
await page.click('.note-card');
await page.waitForSelector('.rt-body img[data-img]', { timeout: 6000 });
await page.waitForTimeout(1200);

const reopened = await page.evaluate(() => {
  const body = document.querySelector('.rt-body');
  const img = body.querySelector('img[data-img]');
  const p = img?.parentElement;
  const ir = img?.getBoundingClientRect();
  const pr = p?.getBoundingClientRect();
  return {
    imgStyle: img?.getAttribute('style') ?? '',
    // 重开后不该有带着对齐样式的空段落（保存前已清掉）
    strayP: [...body.querySelectorAll(':scope > p')].filter((x) => x.getAttribute('style') && !(x.textContent ?? '').trim()).length,
    centerDelta: ir && pr ? Math.abs((ir.left + ir.right) / 2 - (pr.left + pr.right) / 2) : 999,
    imgVisible: !!ir && ir.width > 0,
  };
});
console.log('  重开后:', JSON.stringify(reopened));
rec('③ 重开后图片仍是居中的（样式存在 img 上）', reopened.imgStyle === 'text-align:center', reopened.imgStyle);
rec('③ 重开后没有残留的带样式空段落', reopened.strayP === 0, `stray=${reopened.strayP}`);
rec('③ 重开后图片仍然居中', reopened.centerDelta <= 2 && reopened.imgVisible, `中心差=${reopened.centerDelta}px`);

/* ---------- ④ 清洗器：只放行「纯 text-align」，挡掉混装与事件属性 ---------- */
  const sanit = await page.evaluate(async () => {
    const m = await import('/src/data/noteBody.ts');
    return {
      canonical: m.sanitizeNoteHtml('<p style="text-align: center;">标题</p>'),
      left: m.sanitizeNoteHtml('<p style="text-align:left">标题</p>'),
      mixed: m.sanitizeNoteHtml('<p style="color:red;text-align:center">标题</p>'),
      badValue: m.sanitizeNoteHtml('<p style="text-align:evil">标题</p>'),
      eventAttr: m.sanitizeNoteHtml('<p style="text-align:center" onclick="alert(1)">x</p>'),
      onSpan: m.sanitizeNoteHtml('<span style="text-align:center">行内</span>'),
      imgWidth: m.sanitizeNoteHtml('<img data-img="abc" alt="" width="180">'),
      imgAlign: m.sanitizeNoteHtml('<img data-img="abc" alt="" width="180" style="text-align: center;">'),
      imgAlignBad: m.sanitizeNoteHtml('<img data-img="abc" alt="" style="color:red">'),
    };
  });
  console.log('  清洗结果:', JSON.stringify(sanit));
  rec('④ 规范形保留：style="text-align:center"', sanit.canonical === '<p style="text-align:center">标题</p>', sanit.canonical);
  rec('④ text-align:left 是默认对齐，按无对齐剥掉', sanit.left === '<p>标题</p>', sanit.left);
rec('④ 混装 style（color+text-align）整条剥掉', !/style/i.test(sanit.mixed) && /标题/.test(sanit.mixed), sanit.mixed);
rec('④ 非法对齐值剥掉', !/style/i.test(sanit.badValue) && /标题/.test(sanit.badValue), sanit.badValue);
rec('④ 事件属性剥掉（style 仍保留）', !/onclick/i.test(sanit.eventAttr) && /text-align:center/.test(sanit.eventAttr), sanit.eventAttr);
rec('④ 行内标签上的 text-align 无效，剥掉', !/style/i.test(sanit.onSpan) && /行内/.test(sanit.onSpan), sanit.onSpan);
rec('④ 图片 width 白名单不受影响', /width="180"/.test(sanit.imgWidth), sanit.imgWidth);
rec('④ 顶层图自己身上的 text-align 也放行（规范形）',
  /style="text-align:center"/.test(sanit.imgAlign) && /width="180"/.test(sanit.imgAlign), sanit.imgAlign);
rec('④ 图上的非对齐 style（color）剥掉', !/style/i.test(sanit.imgAlignBad), sanit.imgAlignBad);

/* ---------- 截图：工具栏 + 对齐态 ---------- */
await page.evaluate(() => {
  const back = [...document.querySelectorAll('.note-editor-head button')].find((b) => /返回列表/.test(b.textContent || ''));
  back?.click();
});
await page.waitForTimeout(300);
await page.click('.note-card');
await page.waitForSelector('.rt-body', { timeout: 6000 });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'v16-editor-align.png') });
const tbShot = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  const r = tb?.getBoundingClientRect();
  return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null;
});
console.log('  工具栏位置:', JSON.stringify(tbShot));

console.log('\npageerrors:', errs.length ? errs : '（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
