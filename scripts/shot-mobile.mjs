import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const URL = 'http://[::1]:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent: UA,
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
try { await page.waitForSelector('.hud-top', { timeout: 25000 }); } catch { console.log('no .hud-top'); }
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT, 'mobile-overview.jpg'), type: 'jpeg', quality: 68 });

// 北京城市下钻
await page.evaluate(() => window.__sandboxApp.focusCityById('110000'));
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'mobile-beijing.jpg'), type: 'jpeg', quality: 68 });

// 区县 3D
await page.evaluate(() => window.__sandboxApp.selectDistrictById('110101'));
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT, 'mobile-district.jpg'), type: 'jpeg', quality: 68 });

await browser.close();
console.log('mobile shots done');
