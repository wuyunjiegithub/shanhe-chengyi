// 游记「列表封面」+「默认标题口径」核查：
// ① 纯文字游记（无自有图片）的封面回落到该地方的主图，而不是空白块
// ② 空标题在列表 / 预览 / 存取三处口径一致，都是「无题游记」（不再出现「（无标题）」）
// ③ 自动保存（自动落库）不会把标题写成空串
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const now = Date.now();
// 预置三篇游记：① 空标题 + 关联区县（无自有图）② 有标题 + 关联城市（无自有图）③ 全空
const seed = [
  {
    id: 'n1', title: '', body: '<p>淳安的山和水，一路都是绿的。</p>',
    placeKind: 'district', placeId: '330127', placeName: '淳安县', images: [],
    createdAt: now - 3000, updatedAt: now - 3000,
  },
  {
    id: 'n2', title: '徽杭古道两日', body: '<p>从绩溪走到临安。</p>',
    placeKind: 'city', placeId: '330100', placeName: '杭州市', images: [],
    createdAt: now - 2000, updatedAt: now - 2000,
  },
  {
    id: 'n3', title: '', body: '', placeKind: null, placeId: null, placeName: '', images: [],
    createdAt: now - 1000, updatedAt: now - 1000,
  },
];

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA_ANDROID,
});
await page.addInitScript((notes) => {
  localStorage.setItem('ds.travelNotes.v1', JSON.stringify(notes));

  // 只给「淳安县」一篇备一张本地照片库里的图，用来验证「无自有图 → 回落地方主图」。
  // 权限桩返回 false，避免 restore() 走相册重建索引把这份种子索引覆盖掉。
  localStorage.setItem('ds.photoLib.mediaAsked.v1', '1');
  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({
      rootName: '本机相册',
      boundAt: new Date().toISOString(),
      persistent: false,
      total: 1,
      byDistrict: {
        '330127': [{ path: '/DCIM/淳安1.jpg', name: '淳安1.jpg', kind: 'image', shape: 'landscape' }],
      },
      byCity: {},
    }),
  );

  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#2a9d8f';
  x.fillRect(0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/png');
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd) => {
      if (cmd === 'media_permission_state') return false;
      if (cmd === 'media_request_permission') return false;
      if (cmd === 'plugin:app|registerListener') return 0;
      throw new Error('unstubbed ' + cmd);
    },
    convertFileSrc: () => dataUrl,
  };
}, seed);
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.openTravelList());
await page.waitForSelector('.note-list', { timeout: 8000 });
await page.waitForTimeout(1200);

/* ① 标题口径统一 */
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('.note-card-title')].map((el) => el.textContent.trim()),
);
rec(
  '列表标题口径统一（空标题 → 无题游记）',
  titles.length === 3 && titles[0] === '无题游记' && titles[1] === '徽杭古道两日' && titles[2] === '无题游记',
  `titles=${JSON.stringify(titles)}`,
);
rec(
  '列表不再出现「（无标题）」',
  titles.every((t) => !t.includes('无标题')),
  `titles=${JSON.stringify(titles)}`,
);

/* ② 封面回落：无自有图片时用该地方主图（真图缺失时降级成带地名的渐变，但不是空白块） */
const covers = await page.evaluate(() =>
  [...document.querySelectorAll('.note-card-cover')].map((el) => {
    const img = el.querySelector('img');
    const fb = el.querySelector('.smart-img.is-fallback');
    const ph = el.querySelector('.note-card-cover-ph');
    return {
      kind: img ? 'img' : fb ? 'fallback' : ph ? 'placeholder' : 'empty',
      glyph: fb ? (fb.querySelector('.smart-img__glyph')?.textContent || '') : '',
      src: img ? img.getAttribute('src') : '',
    };
  }),
);
rec(
  '纯文字游记封面回落到地方主图（不再是空白占位块）',
  covers[0].kind !== 'placeholder' && covers[1].kind !== 'placeholder',
  `covers=${JSON.stringify(covers)}`,
);
rec(
  '本地照片库有该地图时优先用照片库的第一张',
  covers[0].kind === 'img' && covers[0].src.startsWith('data:'),
  `kind=${covers[0].kind} src=${String(covers[0].src).slice(0, 30)}`,
);
rec(
  '城市主图路径按约定推导(/assets/cities/330100/banner.jpg)',
  covers[1].src.includes('/assets/cities/330100/banner.jpg') || covers[1].glyph === '杭',
  `src=${covers[1].src} glyph=${covers[1].glyph}`,
);
rec(
  '既无图片也无地点的游记仍是空白占位块',
  covers[2].kind === 'placeholder',
  `kind=${covers[2].kind}`,
);

await page.screenshot({ path: 'regression-shots/note-list-cover.png' });

/* ③ 预览标题与列表一致 */
await page.click('.note-list li:first-child .note-card');
await page.waitForSelector('.note-preview-title', { timeout: 8000 });
await page.waitForTimeout(400);
const previewTitle = await page.evaluate(
  () => document.querySelector('.note-preview-title')?.textContent.trim() ?? '',
);
rec('预览标题与列表一致（无题游记）', previewTitle === '无题游记', `previewTitle=${previewTitle}`);

/* ④ 自动保存不把标题写成空串 */
await page.click('.note-preview .note-head-actions .primary-btn'); // 编辑
await page.waitForSelector('.note-title-input', { timeout: 8000 });
const inputTitle = await page.inputValue('.note-title-input');
rec('编辑器标题输入框对默认标题显示为空(带占位提示)', inputTitle === '', `inputTitle="${inputTitle}"`);

await page.click('.rt-body');
await page.keyboard.type('再加一句正文，触发自动保存。');
await page.waitForTimeout(1400); // 500ms 防抖 + 余量
const stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ds.travelNotes.v1') || '[]').map((n) => ({ id: n.id, title: n.title })),
);
const n1 = stored.find((n) => n.id === 'n1');
rec(
  '自动保存后标题仍是「无题游记」(未写成空串)',
  n1 && n1.title === '无题游记',
  `stored=${JSON.stringify(stored)}`,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
