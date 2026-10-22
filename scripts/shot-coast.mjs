/** 苏北海岸地形覆盖 + 标记可见性诊断 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// 预置「去过 / 想去」，检查地形之后红旗与爱心是否还看得见
await page.addInitScript(() => {
  localStorage.setItem(
    'ds.cityStatus.v1',
    JSON.stringify({
      visited: ['330100', '320500', '310000'],
      visitedDistricts: ['330127'],
    }),
  );
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/coast-overview.png` });

// 聚焦盐城（苏北海岸）
await page.evaluate(() => window.__sandboxApp?.focusCityById?.('320900'));
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/coast-yancheng.png`, clip: { x: 300, y: 60, width: 900, height: 780 } });

console.log('截图完成');
await browser.close();
