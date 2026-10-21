import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2000);
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2200);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310118'));
await page.waitForTimeout(1000);
await page.locator('.drawer-head-actions .icon-btn').first().click();
await page.waitForTimeout(400);
await page.locator('.drawer-head-actions .icon-btn--visited').click();
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
  const s = window.__sandboxScene;
  function worldSize(obj) {
    obj.updateWorldMatrix(true, true);
    let min = null, max = null;
    obj.traverse((c) => {
      if (c.isMesh && c.geometry) {
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        const bb = c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld);
        min = min ? min.clone().min(bb.min) : bb.min.clone();
        max = max ? max.clone().max(bb.max) : bb.max.clone();
      }
    });
    if (!min) return null;
    return { x: +(max.x-min.x).toFixed(2), y: +(max.y-min.y).toFixed(2), z: +(max.z-min.z).toFixed(2) };
  }
  const markers = [];
  s.scene.traverse((o) => {
    if (o.userData && o.userData.plateId) {
      const flag = o.children.some((c) => c.geometry?.type === 'PlaneGeometry');
      markers.push({ kind: flag ? 'flag' : 'star', plateId: o.userData.plateId, scale: +o.scale.x.toFixed(3), size: worldSize(o) });
    }
  });
  const rec = s.districts.get('310118');
  const plateSize = rec ? worldSize(rec.meshes[0]) : null;
  return { markers, plateSize };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
