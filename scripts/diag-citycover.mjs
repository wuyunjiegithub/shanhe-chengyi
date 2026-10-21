import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const panel = document.querySelector('.city-panel');
  const cover = document.querySelector('.city-cover');
  return {
    hasPanel: !!panel,
    panelHtml: panel ? panel.innerHTML.slice(0, 600) : null,
    coverImgs: cover ? cover.querySelectorAll('img').length : -1,
    bgPickers: document.querySelectorAll('.city-cover .bg-picker').length,
    fileInputs: document.querySelectorAll('.city-cover input[type=file]').length,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
