// v0.9.17 游记「预览优先」核查：
// ① 已保存游记点卡片进【只读预览】（不是直接进编辑器）
// ② 预览渲染全部富文本：段落对齐 style、图片元素（带 width）都在
// ③ 预览里点「编辑」才进编辑态（.rt-wrap 出现，内容一致）
// ④ 新建游记仍直接进编辑态（写游记入口不受影响）
// ⑤ 预览态不再有「操作按钮提示」：工具栏在预览里根本不渲染，正文无 title 提示
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

const stub = () => {
  const pngUrl = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#f43f5e';
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

/* ---------- ④ 新建游记：直接进编辑态 ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-wrap', { timeout: 8000 });
rec('④ 新建游记直接进编辑态（.rt-wrap 出现，非预览）',
  (await page.$('.note-preview')) === null, '新建即编辑');
await page.waitForTimeout(400);

/* ---------- 写内容：标题 + 正文 + 居中 + 插图 ---------- */
await page.click('.note-title-input');
await page.fill('.note-title-input', '千岛湖测试游记');
await page.click('.rt-body');
await page.keyboard.type('傍晚的湖面很静');
await page.waitForTimeout(150);
// 先把光标所在的文字段落居中（此时还没插图，落点就是文字段）
await page.click('.rt-btn--ico[aria-label="居中"]');
await page.waitForTimeout(250);
// 再插图：图片是顶层块，单独占位
await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 120;
  const x = c.getContext('2d');
  x.fillStyle = '#0ea5e9';
  x.fillRect(0, 0, 200, 120);
  window.__noteEditor.insertImages([{ id: 'v17img', url: c.toDataURL('image/png') }]);
});
// 等这张图解码完（fitImage 才会把 width 写上，插入后的补发 emit 也才会落库）
await page.waitForFunction(
  () => {
    const im = document.querySelector('.rt-body img[data-img]');
    return !!im && im.complete && im.naturalWidth > 0 && !!im.getAttribute('width');
  },
  { timeout: 8000 },
);
await page.waitForTimeout(250);

/* ---------- 保存 ---------- */
await page.click('.note-editor-head .primary-btn'); // 保存
await page.waitForTimeout(600);
// 保存后回到列表
await page.waitForSelector('.note-list', { timeout: 6000 });
rec('① 保存后回到列表（编辑器关闭）', (await page.$('.rt-wrap')) === null, '列表出现');
const cardTitle = await page.$eval('.note-card-title', (el) => el.textContent.trim());
rec('① 列表里出现刚保存的游记', cardTitle.includes('千岛湖'), cardTitle);

/* ---------- ① 点卡片 → 只读预览（不是编辑器） ---------- */
await page.click('.note-card');
await page.waitForSelector('.note-preview', { timeout: 6000 });
rec('① 点已保存游记进【只读预览】.note-preview（而不是编辑器）',
  (await page.$('.note-preview')) !== null && (await page.$('.note-preview .rt-wrap')) === null,
  '预览出现、无编辑器');

/* ---------- ② 预览渲染全部富文本 ---------- */
const prev = await page.evaluate(() => {
  const pv = document.querySelector('.note-preview');
  const body = pv.querySelector('.rt-body');
  // 找带 text 的那个段落（居中的目标）
  const ps = [...body.querySelectorAll('p')];
  const textP = ps.find((p) => (p.textContent ?? '').includes('湖面')) ?? ps[0];
  const img = body.querySelector('img[data-img]');
  return {
    title: pv.querySelector('.note-preview-title')?.textContent?.trim() ?? '',
    pStyle: textP?.getAttribute('style') ?? '',
    // 视觉校验：该段落的计算 text-align 确实是 center（不只是属性在）
    computedAlign: textP ? getComputedStyle(textP).textAlign : '',
    hasImg: !!img,
    imgWidth: img?.getAttribute('width') ?? '',
    editable: body?.getAttribute('contenteditable') ?? 'absent',
    hasToolbar: !!pv.querySelector('.rt-toolbar'),
  };
});
console.log('  预览状态:', JSON.stringify(prev));
rec('② 预览标题正确', prev.title.includes('千岛湖'), prev.title);
rec('② 预览保留段落对齐属性（text-align:center）', prev.pStyle === 'text-align:center', prev.pStyle);
rec('② 预览里居中段落计算样式确为 center（视觉真的居中）', prev.computedAlign === 'center', prev.computedAlign);
rec('② 预览里有图片元素且带 width（原尺寸/缩放兼容）', prev.hasImg && /\d/.test(prev.imgWidth), `img=${prev.hasImg} width=${prev.imgWidth}`);
rec('② 预览正文不可编辑', prev.editable === 'absent' || prev.editable === 'false', `contenteditable=${prev.editable}`);
rec('⑤ 预览态不渲染工具栏（只读，无操作按钮）', !prev.hasToolbar, `toolbar=${prev.hasToolbar}`);

await page.screenshot({ path: path.join(OUT, 'v17-note-preview.png') });

/* ---------- ③ 预览里点「编辑」→ 编辑态 ---------- */
await page.click('.note-preview .primary-btn'); // 编辑
await page.waitForSelector('.rt-wrap', { timeout: 6000 });
rec('③ 预览里点「编辑」进入编辑态（.rt-wrap 出现）', (await page.$('.rt-wrap')) !== null, '编辑器出现');
// 编辑态内容与预览一致（标题 + 对齐还在）
const edt = await page.evaluate(() => ({
  title: document.querySelector('.note-title-input')?.value ?? '',
  pStyle: document.querySelector('.rt-body p')?.getAttribute('style') ?? '',
}));
rec('③ 编辑态带回原内容（标题 + 居中对齐）', edt.title.includes('千岛湖') && edt.pStyle === 'text-align:center', JSON.stringify(edt));
await page.screenshot({ path: path.join(OUT, 'v17-note-edit.png') });

// 过滤 dev server 的网络噪音（429 限流等资源加载失败），只留真正的页面 / 逻辑报错
const realErrs = errs.filter((e) => !/429|Too Many Requests|Failed to load resource/i.test(e));
rec('__无页面报错__', realErrs.length === 0, realErrs.slice(0, 3).join(' | ') || 'clean');

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
