/** 近距观察地形配色 + 验证顶栏「地形」开关 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);

// 滚轮推近，看清山体配色（指针放在地图中心）
await page.mouse.move(650, 400);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(260);
}
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/terrain-close.png`, clip: { x: 380, y: 150, width: 760, height: 620 } });

// 点顶栏「地形」开关 —— 关掉后应回到深色板块，且城市边界仍可见（板块自带的轮廓）
await page.getByRole('button', { name: /地形/ }).first().click();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/terrain-off.png`, clip: { x: 380, y: 150, width: 760, height: 620 } });

console.log('截图完成');
await browser.close();
