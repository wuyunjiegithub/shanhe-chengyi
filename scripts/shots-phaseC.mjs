import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top');
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, 'c1-home.png') });

// 群岛视图：舟山
await page.evaluate(() => window.__sandboxApp.focusCityById('330900'));
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(OUT, 'c2-zhoushan-islands.png') });

// 收藏上海 + 打开城市面板
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.city-actions .city-act--fav')].find((x) => x.textContent.includes('收藏'));
  b && b.click();
});
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, 'c3-shanghai-fav.png') });

// 进入区县再 ESC（验证不黑屏）
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, 'c4-district.png') });
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, 'c5-back-region.png') });

await browser.close();
console.log('shots saved');
