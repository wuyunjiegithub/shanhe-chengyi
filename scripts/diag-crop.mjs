import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

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
await page.waitForTimeout(2600);

const info = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const g = scene.districtMarkerGroup;
  const cam = scene.camera;
  const el = scene.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const proj = (p) => {
    const v = cam.position.clone().copy(p).project(cam);
    return { x: Math.round((v.x * 0.5 + 0.5) * W), y: Math.round((-v.y * 0.5 + 0.5) * H), z: +v.z.toFixed(3) };
  };
  scene.scene.updateMatrixWorld(true);
  return g.children.map((c) => {
    c.updateMatrixWorld(true);
    const wp = c.getWorldPosition(cam.position.clone());
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    c.traverse((o) => {
      if (!o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const s = proj(cam.position.clone().set(x, y, z).applyMatrix4(o.matrixWorld));
        minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x); miny = Math.min(miny, s.y); maxy = Math.max(maxy, s.y);
      }
    });
    return { plateId: c.userData.plateId, scale: +c.scale.x.toFixed(2), center: proj(wp), px: [Math.round(maxx - minx), Math.round(maxy - miny)] };
  });
});
console.log('MARKERS', JSON.stringify(info));

for (const [i, m] of info.entries()) {
  const w = 140, h = 140;
  const cx = Math.max(0, Math.min(info.length ? 1440 - w : 0, m.center.x - w / 2));
  const cy = Math.max(0, Math.min(900 - h, m.center.y - h / 2));
  await page.screenshot({ path: path.join(OUT, `crop-${i}.png`), clip: { x: cx, y: cy, width: w, height: h } });
  console.log('CROP', i, JSON.stringify({ cx, cy }));
}
await browser.close();
