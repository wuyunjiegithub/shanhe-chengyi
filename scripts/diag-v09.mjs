// 快速诊断：抓页面运行时错误
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
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
console.log('阶段1 载入后错误:', errors.length, errors.slice(0, 5));

await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1800);
console.log('阶段2 下钻城市后错误:', errors.length, errors.slice(0, 5));

await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1600);
const drawer = await page.evaluate(() => ({
  open: !!document.querySelector('.drawer.is-open'),
  canvas: !!document.querySelector('.canvas canvas'),
  visits: !!document.querySelector('.visit-date-input'),
}));
console.log('阶段3 区县抽屉:', JSON.stringify(drawer), '错误:', errors.slice(0, 5));

// 打开照片墙
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForTimeout(1600);
const wall = await page.evaluate(() => ({
  modal: !!document.querySelector('.wall-modal'),
  tiles: document.querySelectorAll('.wall-tile').length,
  sorts: document.querySelectorAll('.wall-sort-chip').length,
  canvas: !!document.querySelector('.canvas canvas'),
}));
console.log('阶段4 照片墙:', JSON.stringify(wall), '错误:', errors.slice(0, 8));

// 切到 3D 照片空间
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.wall-style-chip')].find((x) => x.textContent.includes('3D'));
  b && b.click();
});
await page.waitForTimeout(3000);
const hall = await page.evaluate(() => {
  const el = document.querySelector('.hall3d canvas');
  return {
    hasCanvas: !!el,
    w: el ? el.clientWidth : 0,
    h: el ? el.clientHeight : 0,
    tip: !!document.querySelector('.hall3d-tip'),
    loading: document.querySelector('.hall3d-loading')?.textContent ?? null,
  };
});
console.log('阶段5 3D照片空间:', JSON.stringify(hall), '错误:', errors.slice(0, 8));

await browser.close();
