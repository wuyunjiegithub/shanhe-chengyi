// 诊断：整城视图下收藏/去过标记是否清晰可见；并裁剪截图局部
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
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror:' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
// 预置：淳安 既收藏 又 去过
await page.evaluate(() => {
  localStorage.setItem('ds.favorites.v1', JSON.stringify({ districts: ['330127'], spots: [], cities: [] }));
  localStorage.setItem('ds.cityStatus.v1', JSON.stringify({ want: [], visited: [], visitedDistricts: ['330127'] }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1600);

await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2600);
await page.screenshot({ path: path.join(OUT, 'mk-city-full.png') });

const info = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const g = scene.districtMarkerGroup;
  const cam = scene.camera;
  const el = scene.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const scratch = cam.position.clone();
  const proj = (p) => {
    const v = cam.position.clone().copy(p).project(cam);
    return { x: Math.round((v.x * 0.5 + 0.5) * W), y: Math.round((-v.y * 0.5 + 0.5) * H), z: +v.z.toFixed(3) };
  };
  scene.scene.updateMatrixWorld(true);
  const items = g.children.map((c) => {
    const wp = c.getWorldPosition(scratch.clone());
    // 逐网格 8 角投影求屏幕包围盒
    c.updateMatrixWorld(true);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    c.traverse((o) => {
      if (!o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const s = proj(cam.position.clone().set(x, y, z).applyMatrix4(o.matrixWorld));
        minx = Math.min(minx, s.x); maxx = Math.max(maxx, s.x);
        miny = Math.min(miny, s.y); maxy = Math.max(maxy, s.y);
      }
    });
    return { plateId: c.userData.plateId, scale: +c.scale.x.toFixed(3), screen: proj(wp), pxBox: [Math.round(maxx - minx), Math.round(maxy - miny)] };
  });
  return { groupVisible: g.visible, count: g.children.length, items, viewport: { W, H } };
});
console.log('MARKERS', JSON.stringify(info));
console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none');

// 裁一块以第一个标记为中心的区域
if (info.items[0]) {
  const { x, y } = info.items[0].screen;
  const w = 260, h = 220;
  const cx = Math.max(0, Math.min(info.viewport.W - w, x - w / 2));
  const cy = Math.max(0, Math.min(info.viewport.H - h, y - h / 2));
  await page.screenshot({ path: path.join(OUT, 'mk-crop.png'), clip: { x: cx, y: cy, width: w, height: h } });
  console.log('CROP', JSON.stringify({ cx, cy, w, h }));
}
await browser.close();
