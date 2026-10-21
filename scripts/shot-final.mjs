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
await page.screenshot({ path: 'regression-shots/final-region-2.png' });

// 收藏面板（应无「想去的城市」）
await page.evaluate(() => {
  const b = document.querySelector('.bottom-right .fav-pill');
  b && b.click();
});
await page.waitForTimeout(700);
const sections = await page.evaluate(() =>
  [...document.querySelectorAll('.fav-panel .fav-section .block-title')].map((e) => e.textContent.trim()),
);
console.log('SECTIONS', JSON.stringify(sections));
const box = await page.evaluate(() => {
  const el = document.querySelector('.fav-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
if (box) await page.screenshot({ path: 'regression-shots/ui-fav.png', clip: box });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 城市视图整屏
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2600);
await page.screenshot({ path: 'regression-shots/final-city-2.png' });
await browser.close();
