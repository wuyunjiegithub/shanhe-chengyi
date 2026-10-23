// v0.9.18 游记头部操作区核查：
// ① 预览 / 编辑态头部按钮顺序：返回列表 →（编辑/保存）→ 删除 → ×（× 在最右）
// ② 删除钮从正文底部角落搬到头部操作区（.note-editor-foot 不再存在）
// ③ 头部单行不换行、不越界（手机 390px 宽）
// ④ 删除二次确认：第一点变「确认删除」，再点才真删，游记从列表消失
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
        case 'media_album_photos': return photos;
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
  if (msg.type() === 'error' && !/429|Failed to load resource/.test(msg.text())) {
    errs.push('console: ' + msg.text().slice(0, 160));
  }
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3200);

/** 头部按钮的序号 / 文案 / 几何（按 DOM 顺序） */
const headInfo = () =>
  page.evaluate(() => {
    const head = document.querySelector('.note-editor-head');
    if (!head) return null;
    const btns = [...head.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || '').trim(),
        cls: b.className,
        top: Math.round(r.top),
        left: Math.round(r.left),
        right: Math.round(r.right),
      };
    });
    const hr = head.getBoundingClientRect();
    return { btns, head: { left: Math.round(hr.left), right: Math.round(hr.right) } };
  });

/* ---------- ① 新建 → 编辑态头部顺序 ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-wrap', { timeout: 8000 });
await page.waitForTimeout(400);

const ed = await headInfo();
console.log('  编辑态头部:', JSON.stringify(ed?.btns));
const edOrder = (ed?.btns ?? []).map((b) => (/返回/.test(b.text) ? '返回' : /保存/.test(b.text) ? '保存' : /删除|确认/.test(b.text) ? '删除' : b.text === '×' ? '×' : b.text));
rec('① 编辑态头部顺序 = 返回 / 保存 / ×（新建无删除钮）',
  JSON.stringify(edOrder) === JSON.stringify(['返回', '保存', '×']), JSON.stringify(edOrder));
rec('② 编辑态：× 在头部最后一个（最右）',
  (ed?.btns ?? []).length >= 2 && ed.btns[ed.btns.length - 1].text === '×', JSON.stringify(edOrder));
rec('③ 正文底部不再有删除按钮角落（.note-editor-foot 不存在）',
  (await page.$('.note-editor-foot')) === null, 'no footer');

/* ---------- 保存 → 列表 ---------- */
await page.click('.note-title-input');
await page.fill('.note-title-input', '头部按钮测试');
await page.click('.rt-body');
await page.keyboard.type('第一段正文');
await page.waitForTimeout(300);
await page.click('.note-editor-head .primary-btn'); // 保存
await page.waitForSelector('.note-list', { timeout: 6000 });

/* ---------- ④ 预览态头部顺序：返回 / 编辑 / 删除 / × ---------- */
await page.click('.note-card');
await page.waitForSelector('.note-preview', { timeout: 6000 });
await page.waitForTimeout(300);
const pv = await headInfo();
console.log('  预览态头部:', JSON.stringify(pv?.btns));
const pvOrder = (pv?.btns ?? []).map((b) => (/返回/.test(b.text) ? '返回' : /编辑/.test(b.text) ? '编辑' : /删除|确认/.test(b.text) ? '删除' : b.text === '×' ? '×' : b.text));
rec('④ 预览态头部顺序 = 返回 / 编辑 / 删除 / ×',
  JSON.stringify(pvOrder) === JSON.stringify(['返回', '编辑', '删除', '×']), JSON.stringify(pvOrder));
rec('⑤ 编辑钮在 × 左边（关闭在最右）',
  pvOrder.indexOf('编辑') === pvOrder.indexOf('×') - 2, JSON.stringify(pvOrder));

// 几何：按钮同一行（top 一致）、不越出面板右边界
const tops = new Set((pv?.btns ?? []).map((b) => b.top));
rec('⑥ 头部按钮单行排布（不换行）', tops.size <= 2, `tops=${[...tops].join(',')}`);
const overflowRight = (pv?.btns ?? []).filter((b) => b.right > (pv?.head?.right ?? 0) + 1);
rec('⑦ 头部按钮不越出面板右边界（窄屏 390px）',
  overflowRight.length === 0, `越界 ${overflowRight.length} 个；面板右=${pv?.head?.right}`);
const actions = await page.evaluate(() => {
  const g = document.querySelector('.note-head-actions');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log('  操作组尺寸:', JSON.stringify(actions));

await page.screenshot({ path: path.join(OUT, 'v18-note-preview-head.png') });

/* ---------- ⑧ 删除二次确认 ---------- */
await page.click('.note-head-del');
await page.waitForTimeout(200);
const armed = await page.evaluate(() => {
  const b = document.querySelector('.note-head-del');
  return { text: (b?.textContent || '').trim(), danger: b?.classList.contains('is-danger') ?? false };
});
console.log('  第一次点删除:', JSON.stringify(armed));
rec('⑧ 第一次点删除 → 变「确认删除」且高亮危险色',
  armed.text === '确认删除' && armed.danger, JSON.stringify(armed));

await page.click('.note-head-del'); // 第二次：真删
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({
  list: !!document.querySelector('.note-list'),
  cards: document.querySelectorAll('.note-card').length,
  panel: !!document.querySelector('.travel-panel'),
}));
console.log('  删除后:', JSON.stringify(after));
rec('⑨ 第二次点删除：游记真被删掉（回到列表且卡片消失）',
  after.panel && after.cards === 0, JSON.stringify(after));

rec('__无页面报错__', errs.length === 0, errs.slice(0, 3).join(' | ') || 'clean');

const pass = results.filter((r) => r.ok).length;
console.log(`\n===== ${pass}/${results.length} 通过 =====`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
