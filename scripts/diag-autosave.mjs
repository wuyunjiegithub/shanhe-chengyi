import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLEERR', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2000);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-actions button')].find((x) => x.textContent.includes('写游记'));
  b && b.click();
});
await page.waitForTimeout(800);
console.log('editor?', await page.evaluate(() => !!document.querySelector('.note-editor')));
console.log('title input?', await page.evaluate(() => !!document.querySelector('.note-title-input')));

await page.fill('.note-title-input', '自动保存测试');
await page.fill('.note-body-input', '这是一段自动保存的正文。');
const mid = await page.evaluate(() => ({
  titleVal: document.querySelector('.note-title-input')?.value,
  bodyVal: document.querySelector('.note-body-input')?.value,
  ls: localStorage.getItem('ds.travelNotes.v1'),
}));
console.log('MID', JSON.stringify(mid));

await page.keyboard.press('Escape');
await page.waitForTimeout(900);
console.log('after ESC', JSON.stringify(await page.evaluate(() => ({
  editor: !!document.querySelector('.note-editor'),
  travelPanel: !!document.querySelector('.travel-panel'),
  ls: localStorage.getItem('ds.travelNotes.v1'),
}))));

// 重新打开
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bottom-right button')].find((x) => x.textContent.includes('游记'));
  b && b.click();
});
await page.waitForTimeout(800);
console.log('after reopen', JSON.stringify(await page.evaluate(() => ({
  travelPanel: !!document.querySelector('.travel-panel'),
  cards: document.querySelectorAll('.note-card').length,
  titles: [...document.querySelectorAll('.note-card-title')].map((e) => e.textContent.trim()),
  empty: !!document.querySelector('.block-empty'),
  ls: localStorage.getItem('ds.travelNotes.v1'),
}))));

await browser.close();
