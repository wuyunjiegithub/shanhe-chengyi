/** 截地形图层效果：省视角正视 + 斜视，检查真实湖岸线与山地起伏。 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);

await page.screenshot({ path: path.join(OUT, 'terrain-overview.png') });

// 稍微压低机位看山体起伏（滚轮/拖拽模拟）——直接拖拽画布抬视角
const box = await page.locator('canvas').first().boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 130, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'terrain-tilt.png') });
}

console.log('截图完成');
if (errors.length) console.log('控制台异常：\n' + errors.slice(0, 12).join('\n'));
else console.log('控制台无异常');

await browser.close();
