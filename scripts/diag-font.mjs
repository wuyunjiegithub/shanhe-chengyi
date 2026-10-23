// 调试：apply 字体后 queryCommandValue('fontName') 返回什么、selectionchange 是否触发
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
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
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'log') console.log('  [page]', m.text().slice(0, 160)); });
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => { throw new Error('unstubbed'); }, convertFileSrc: (p) => p };
  window.__selLog = [];
  document.addEventListener('selectionchange', () => {
    const s = getSelection();
    window.__selLog.push({
      v: document.queryCommandValue('fontName'),
      inEditor: !!document.querySelector('.rt-body') && document.querySelector('.rt-body').contains(s.rangeCount ? s.getRangeAt(0).commonAncestorContainer : null),
    });
  });
});
await page.goto('http://localhost:1420/', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(2500);

await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(400);

await page.click('.rt-body');
await page.keyboard.type('千岛湖的清晨');
await page.keyboard.press('Control+a');
await page.waitForTimeout(200);
console.log('选区内字体查询:', await page.evaluate(() => document.queryCommandValue('fontName')));

await page.selectOption('.rt-font', { label: '楷体' });
await page.waitForTimeout(400);
console.log('apply 后查询:', await page.evaluate(() => document.queryCommandValue('fontName')));
console.log('下拉当前值:', await page.$eval('.rt-font', (el) => el.value));
console.log('selectionchange 次数:', await page.evaluate(() => window.__selLog.length));
console.log('selectionchange 明细:', JSON.stringify(await page.evaluate(() => window.__selLog.slice(-6))));
await browser.close();
