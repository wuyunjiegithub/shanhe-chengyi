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
await page.waitForTimeout(2600);
await page.screenshot({ path: 'regression-shots/ui-region-bottom.png', clip: { x: 0, y: 760, width: 1440, height: 140 } });

await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2400);
const acts = await page.evaluate(() =>
  [...document.querySelectorAll('.city-actions .city-act')].map((b) => b.textContent.trim()),
);
const panelBox = await page.evaluate(() => {
  const el = document.querySelector('.city-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
console.log('ACTS', JSON.stringify(acts), 'BOX', JSON.stringify(panelBox));
if (panelBox) {
  await page.screenshot({ path: 'regression-shots/ui-city-panel.png', clip: panelBox });
}

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bottom-right button')].find((x) => x.textContent.includes('时间线'));
  b && b.click();
});
await page.waitForTimeout(700);
const tlBox = await page.evaluate(() => {
  const el = document.querySelector('.timeline-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
if (tlBox) await page.screenshot({ path: 'regression-shots/ui-timeline.png', clip: tlBox });
console.log('TL', JSON.stringify(tlBox));
await browser.close();
