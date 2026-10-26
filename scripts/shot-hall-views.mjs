/** 3D 照片空间取景：默认视角 / 抬头看上层 / 低头看下层 —— 肉眼确认上下两层真的能看 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:1421/out/_probe/hall.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${BASE}?n=80`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__hall3d, null, { timeout: 30000 });
await page.waitForTimeout(2500);

const drag = async (from, to) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
};
const cam = () => page.evaluate(() => window.__hall3d.cam());

await page.screenshot({ path: 'regression-shots/hall-view-0-default.png' });
await drag([640, 620], [640, 380]);
console.log('抬头看上层 polar =', (await cam()).polar);
await page.screenshot({ path: 'regression-shots/hall-view-1-up.png' });
await drag([640, 380], [640, 760]);
console.log('低头看下层 polar =', (await cam()).polar);
await page.screenshot({ path: 'regression-shots/hall-view-2-down.png' });

await browser.close();
