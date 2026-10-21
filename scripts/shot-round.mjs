import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2800);

// 城市视图整屏 + 地图区裁剪（看区县分界）
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3200);
await page.screenshot({ path: 'regression-shots/round-city-full.png' });
await page.screenshot({
  path: 'regression-shots/round-city-crop.png',
  clip: { x: 250, y: 96, width: 800, height: 720 },
});

// 区县抽屉（收藏 / 去过 / 到访时间）
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1800);
await page.screenshot({ path: 'regression-shots/round-drawer.png' });
await browser.close();
console.log('done');
