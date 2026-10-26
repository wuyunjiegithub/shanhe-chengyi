import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const URL = 'http://[::1]:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const W = 1440, H = 900;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.index-group-title', { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'ui-overview.png') });

// 城市下钻：北京
await page.evaluate(() => window.__sandboxApp.focusCityById('110000'));
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'ui-beijing.png') });

// 区县 3D 视图：东城区
await page.evaluate(() => window.__sandboxApp.selectDistrictById('110101'));
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT, 'ui-district.png') });

// 手机竖屏总览
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(2500);
const mb = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await mb.goto(URL, { waitUntil: 'domcontentloaded' });
try {
  await mb.waitForSelector('.hud-top', { timeout: 25000 });
} catch {
  console.log('mobile: .hud-top 未出现，直接截图');
}
await mb.waitForTimeout(3500);
await mb.screenshot({ path: path.join(OUT, 'ui-mobile.png') });

await browser.close();
console.log('shots done:', ['ui-overview', 'ui-beijing', 'ui-district', 'ui-mobile'].join(', '));
