import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1420/?bust=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);

const probe = () =>
  page.evaluate(() => {
    const drawer = document.querySelector('.drawer.is-open');
    const cover = drawer ? document.querySelector('.drawer-cover') : document.querySelector('.city-cover');
    const picker = cover?.querySelector('.bg-picker');
    if (!picker) return { found: false };
    const btn = picker.querySelector('.bg-picker-btn');
    const bb = btn.getBoundingClientRect();
    const top = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
    return {
      found: true,
      cover: (() => { const r = cover.getBoundingClientRect(); return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) }; })(),
      btn: { x: Math.round(bb.x), right: Math.round(bb.right), w: Math.round(bb.width) },
      topIsBtn: top === btn,
      // 按钮四角 2px 内都能命中才算真没被裁
      cornersHit: [[bb.x + 2, bb.y + 2], [bb.right - 2, bb.y + 2], [bb.x + 2, bb.bottom - 2], [bb.right - 2, bb.bottom - 2]].every(
        ([x, y]) => picker.contains(document.elementFromPoint(x, y)),
      ),
    };
  });

await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(1600);
console.log('CITY', JSON.stringify(await probe()));
await page.screenshot({ path: 'regression-shots/diag-bgpicker-city.png', clip: await page.evaluate(() => {
  const r = document.querySelector('.city-cover').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}) });

await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);
console.log('DISTRICT', JSON.stringify(await probe()));
await page.screenshot({ path: 'regression-shots/diag-bgpicker-district.png', clip: await page.evaluate(() => {
  const r = document.querySelector('.drawer.is-open').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: 240 };
}) });
await browser.close();
