/** 聚焦太湖：验证湖泊在真实地形上是否正常显示 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);

// 缩放到太湖附近（先整体推近，再拖拽把太湖移到画面中心）
await page.mouse.move(650, 400);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(240);
}
await page.waitForTimeout(1500);

// 向右下拖拽：把西北方向的太湖拉到中心
const box = await page.locator('canvas').first().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 120, cy + 90, { steps: 16 });
await page.mouse.up();
await page.waitForTimeout(2000);

await page.screenshot({ path: `${OUT}/terrain-taihu.png`, clip: { x: 340, y: 120, width: 820, height: 660 } });
console.log('截图完成');
await browser.close();
