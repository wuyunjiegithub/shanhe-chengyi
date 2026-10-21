// 全国视图 + 城市视图截图目检（41 市全部录入后）
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/final-national.png' });

// 切到城市视图（点击任意已录入城市，如南京）
const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 200; i++) {
    for (let j = 0; j < 140; j++) {
      const nx = (i / 199) * 2 - 1, ny = 1 - (j / 139) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === '320100') {
        return { x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
});
if (hit) {
  await page.mouse.click(hit.x, hit.y);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: OUT + '/final-city-nanjing.png' });
  // 打开抽屉看区县列表
  const drawer = await page.$('.district-drawer, .drawer');
  if (drawer) await page.screenshot({ path: OUT + '/final-drawer.png' });
}
console.log('shots done, hit:', JSON.stringify(hit));
await browser.close();
