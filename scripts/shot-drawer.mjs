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
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(1800);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1800);
// 滚到「到访时间」区块
const info = await page.evaluate(() => {
  const scroll = document.querySelector('.drawer-scroll');
  const titles = [...document.querySelectorAll('.drawer-scroll .block-title')].map((e) => e.textContent.trim());
  const target = [...document.querySelectorAll('.drawer-scroll .block-title')].find((e) =>
    e.textContent.includes('到访'),
  );
  const rTarget = target?.getBoundingClientRect();
  const rScroll = scroll?.getBoundingClientRect();
  return {
    titles,
    scrollTop: scroll ? rScroll.top : null,
    targetTop: rTarget ? rTarget.top : null,
  };
});
console.log('DRAWER', JSON.stringify(info));
const box = await page.evaluate(() => {
  const el = document.querySelector('.drawer.is-open') || document.querySelector('.drawer');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
// 滚动让到访区块进入视野
await page.evaluate(() => {
  const scroll = document.querySelector('.drawer-scroll');
  const target = [...document.querySelectorAll('.drawer-scroll .block-title')].find((e) =>
    e.textContent.includes('到访'),
  );
  if (scroll && target) scroll.scrollTop = target.offsetTop - 160;
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'regression-shots/ui-drawer-visit.png', clip: box });
await browser.close();
