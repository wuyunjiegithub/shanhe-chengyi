// 诊断：城市取景是否落在可见区
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
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const el = s.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const proj = (v) => {
    const q = v.clone().project(cam);
    return [Math.round((q.x * 0.5 + 0.5) * W), Math.round((-q.y * 0.5 + 0.5) * H)];
  };
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [, rec] of s.districts.entries()) {
    for (const mesh of rec.meshes) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const p = cam.position.clone();
            p.set(x, y, z);
            mesh.localToWorld(p);
            const [px, py] = proj(p);
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
    }
  }
  const city = s.cities.get('330100');
  const c = cam.position.clone();
  c.set(city.centroid[0], city.height, -city.centroid[1]);
  return {
    W,
    H,
    camPos: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
    target: [+s.controls.target.x.toFixed(1), +s.controls.target.y.toFixed(1), +s.controls.target.z.toFixed(1)],
    targetProjected: proj(s.controls.target.clone()),
    cityCentroidProjected: proj(c),
    districtX: [minX, maxX],
    districtY: [minY, maxY],
    districtCount: s.districts.size,
    districtIds: [...s.districts.keys()].slice(0, 30),
    usable: typeof s.usableView === 'function' ? s.usableView() : 'n/a',
    lastFrame: s.lastFrame,
    dist: +cam.position.distanceTo(s.controls.target).toFixed(2),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
