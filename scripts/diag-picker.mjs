import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';
import fs from 'node:fs';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const errs = [];
m.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 20000 });
await m.waitForTimeout(2000);

// 打开区县抽屉
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 });
await m.waitForTimeout(1000);

// 点「写游记」
const noteBtn = await m.$('.place-act--note');
console.log('写游记按钮存在:', !!noteBtn);
if (noteBtn) { await noteBtn.click(); await m.waitForTimeout(1200); }

await m.waitForSelector('.note-editor', { timeout: 8000 });
await m.screenshot({ path: `${OUT}/diag-editor.png` });

// 读取编辑器头部计算样式
const editorHead = await m.evaluate(() => {
  const h = document.querySelector('.note-editor-head');
  if (!h) return null;
  const cs = getComputedStyle(h);
  return { pt: cs.paddingTop, rect: h.getBoundingClientRect() };
});
console.log('note-editor-head:', JSON.stringify(editorHead));

// 点「＋ 插入照片」
const insertBtn = await m.$('.note-images-acts button');
console.log('插入照片按钮存在:', !!insertBtn, insertBtn ? (await insertBtn.innerText()) : '');
if (insertBtn) { await insertBtn.click(); await m.waitForTimeout(1200); }

const picker = await m.evaluate(() => {
  const bd = document.querySelector('.np-backdrop');
  if (!bd) return { exists: false };
  const panel = document.querySelector('.np-panel');
  const head = document.querySelector('.np-head');
  const toolbar = document.querySelector('.np-toolbar');
  const grid = document.querySelector('.np-grid');
  const foot = document.querySelector('.np-foot');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    exists: true,
    panelRect: rect(panel),
    panelOverflow: cs(panel)?.overflow,
    headPt: cs(head)?.paddingTop,
    headRect: rect(head),
    toolbarDisplay: cs(toolbar)?.display,
    toolbarRect: rect(toolbar),
    gridRect: rect(grid),
    footRect: rect(foot),
    // 视口
    vw: window.innerWidth, vh: window.innerHeight,
  };
});
console.log('picker:', JSON.stringify(picker, null, 2));
await m.screenshot({ path: `${OUT}/diag-picker.png` });

// 顶部是否溢出视口（被系统状态栏遮挡的代理判断：head 的 top < 状态栏高度约 24，但 headless 无状态栏）
console.log('pageerrors:', errs.length, errs.slice(0, 3).join(' | '));
await browser.close();
