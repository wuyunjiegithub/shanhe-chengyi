// 量测：手机竖屏下初始 / 总览地图占屏比例（区域包围盒投影到屏幕像素）
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import path from 'node:path';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const errs = [];
m.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await m.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await m.waitForSelector('.hud-top', { timeout: 20000 });
await m.waitForTimeout(3000);

const measure = () =>
  m.evaluate(() => {
    const s = window.__sandboxScene;
    if (!s) return { error: 'no scene' };
    const cam = s.camera;
    const el = s.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const proj = (v) => {
      const q = v.clone().project(cam);
      return [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H];
    };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [, rec] of s.cities.entries()) {
      for (const mesh of rec.meshes) {
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        if (!bb) continue;
        for (const x of [bb.min.x, bb.max.x])
          for (const y of [bb.min.y, bb.max.y])
            for (const z of [bb.min.z, bb.max.z]) {
              const p = cam.position.clone();
              p.set(x, y, z);
              mesh.localToWorld(p);
              const [px, py] = proj(p);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }
      }
    }
    const anchors = {};
    for (const id of ['330100', '310000', '320100', '320500', '330200', '330300']) {
      const rec = s.cities.get(id);
      if (!rec) { anchors[id] = null; continue; }
      const c = cam.position.clone();
      c.set(rec.centroid[0], rec.height, -rec.centroid[1]);
      const [px, py] = proj(c);
      anchors[id] = [Math.round(px), Math.round(py)];
    }
    return {
      W, H,
      mapBox: [Math.round(minX), Math.round(maxX), Math.round(minY), Math.round(maxY)],
      mapW: Math.round(maxX - minX), mapH: Math.round(maxY - minY),
      fillW: +((maxX - minX) / W).toFixed(3),
      fillH: +((maxY - minY) / H).toFixed(3),
      anchors,
      usable: s.usableView(),
      lastFrame: s.lastFrame,
      dist: +cam.position.distanceTo(s.controls.target).toFixed(2),
    };
  });

const before = await measure();
console.log('BEFORE(初始) :', JSON.stringify(before));
await m.screenshot({ path: path.join(OUT, 'mapfill-before.png') });

const reset = await m.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => /总览|复位|重置/.test(x.textContent || ''));
  if (b) { b.click(); return (b.textContent || '').trim(); }
  return null;
});
console.log('reset button:', reset);
await m.waitForTimeout(2500);
const after = await measure();
console.log('AFTER(总览)  :', JSON.stringify(after));
await m.screenshot({ path: path.join(OUT, 'mapfill-after.png') });

console.log('pageerrors:', errs);
await browser.close();
