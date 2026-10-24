import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const REG = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function rec(name, pass, info) {
  results.push({ name, pass, info });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${info}`);
}

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text());
});
await page.goto(REG, { waitUntil: 'networkidle' });

// 打开游记编辑器
await page.evaluate(() => window.__sandboxApp.openTravelEditor({ kind: 'district', id: '330127', name: '淳安县' }));
await page.waitForSelector('.rt-toolbar', { timeout: 8000 });
await page.waitForTimeout(400);

// 1) 安卓套壳下，编辑面板应被锚定为 position:fixed
const posFixed = await page.evaluate(() => {
  const sec = document.querySelector('.travel-panel--editor');
  return sec ? getComputedStyle(sec).position : 'none';
});
rec('编辑面板在安卓下锚定 position:fixed', posFixed === 'fixed', `position=${posFixed}`);

// 2) 工具栏初始在可见区内（不应被裁到负坐标，也不应超出视口底部）
const vh = 780;
const t0 = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  return Math.round(tb.getBoundingClientRect().top);
});
rec('键盘未弹时工具栏在可见区内(top>=0 且 < 视口高)', t0 >= 0 && t0 < vh, `toolbar.top=${t0}`);

// 3) 模拟键盘弹出：把 visualViewport 上推 300px，触发 scroll/resize 事件
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 300 });
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 300 });
  vv.dispatchEvent(new Event('scroll'));
  vv.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(300);

const after = await page.evaluate(() => {
  const sec = document.querySelector('.travel-panel--editor');
  const tb = document.querySelector('.rt-toolbar');
  return {
    secTop: sec ? sec.style.top : null,
    tbTop: Math.round(tb.getBoundingClientRect().top),
  };
});
rec('键盘弹出后面板 top 跟随可见区(=300px)', after.secTop === '300px', `section.style.top=${after.secTop}`);
rec(
  '键盘弹出后工具栏仍可见(随面板移动、未离屏)',
  after.tbTop >= 0 && after.tbTop < vh && after.tbTop === t0 + 300,
  `toolbar.top=${after.tbTop} (前=${t0}, 位移=${after.tbTop - t0})`,
);

// 4) 正文内部滚动，工具栏不应被带走（结构上钉在顶部）
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight });
  vv.dispatchEvent(new Event('scroll'));
  vv.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(200);
const tbBeforeScroll = await page.evaluate(() => Math.round(document.querySelector('.rt-toolbar').getBoundingClientRect().top));
await page.evaluate(() => {
  const body = document.querySelector('.rt-body');
  body.scrollTop = body.scrollHeight;
});
await page.waitForTimeout(200);
const tbAfterScroll = await page.evaluate(() => Math.round(document.querySelector('.rt-toolbar').getBoundingClientRect().top));
rec('正文滚动后工具栏顶部位移不变', Math.abs(tbBeforeScroll - tbAfterScroll) <= 1, `before=${tbBeforeScroll} after=${tbAfterScroll}`);

await page.screenshot({ path: 'regression-shots/editor-keyboard-mobile.png' });

const failed = results.filter((r) => !r.pass);
console.log(`\n汇总: ${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
