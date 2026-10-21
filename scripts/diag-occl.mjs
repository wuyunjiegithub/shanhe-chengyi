import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem('ds.favorites.v1', JSON.stringify({ districts: ['330127'], spots: [], cities: [] }));
  localStorage.setItem('ds.cityStatus.v1', JSON.stringify({ want: [], visited: [], visitedDistricts: ['330127'] }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3000);

// 强制：关闭深度测试 + 放大 1.8 倍
await page.evaluate(() => {
  const g = window.__sandboxScene.districtMarkerGroup;
  for (const m of g.children) {
    m.scale.multiplyScalar(1.8);
    m.traverse((o) => {
      if (o.material && o.material.depthTest !== undefined) {
        o.material.depthTest = false;
        o.material.depthWrite = false;
        o.renderOrder = 10;
      }
    });
    m.renderOrder = 10;
  }
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'regression-shots/debug-occl.png' });
await browser.close();
