import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { decodePng, pixel, lum } from './png.mjs';

const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3000);
await page.evaluate(() => window.__sandboxScene.setPaused(true));
await page.waitForTimeout(300);

async function measure(label) {
  const probe = await page.evaluate(() => {
    const scene = window.__sandboxScene;
    const cam = scene.camera;
    const el = scene.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const toScreen = (v) => {
      const p = v.clone().project(cam);
      return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, z: p.z };
    };
    const samples = [];
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    let onScreen = 0;
    for (const [id, rec] of scene.districts.entries()) {
      const mesh = rec.meshes[0];
      if (!mesh) continue;
      const edges = mesh.children.find((c) => c.isLine2 || c.type === 'Line2');
      if (!edges) continue;
      const attr = edges.geometry.attributes.instanceStart;
      if (!attr) continue;
      const n = attr.count;
      const step = Math.max(1, Math.floor(n / 10));
      // 板块有 rotation.x=-90°：几何局部 (x, y2d, z挤压) → 世界 (x, z, -y2d)。
      // 质心的世界坐标直接是 (cx, height, -cy)（与 marker 落位一致），不要再走 localToWorld。
      const cw = cam.position.clone();
      cw.set(rec.centroid[0], rec.height, -rec.centroid[1]);
      const cs = toScreen(cw);
      minX = Math.min(minX, cs.x); maxX = Math.max(maxX, cs.x);
      minY = Math.min(minY, cs.y); maxY = Math.max(maxY, cs.y);
      if (cs.x > 0 && cs.x < W && cs.y > 0 && cs.y < H) onScreen += 1;
      for (let i = 0; i < n; i += step) {
        const p = mesh.position.clone();
        p.set(attr.getX(i), attr.getY(i), attr.getZ(i));
        mesh.localToWorld(p);
        const s = toScreen(p);
        if (s.x < 2 || s.y < 2 || s.x > W - 2 || s.y > H - 2) continue;
        const dx = cs.x - s.x;
        const dy = cs.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        samples.push({ id, x: s.x, y: s.y, ix: s.x + (dx / d) * 6, iy: s.y + (dy / d) * 6 });
      }
    }
    return { W, H, samples, bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }, onScreen, districts: scene.districts.size };
  });

  const shot = await page.screenshot();
  const img = decodePng(shot);
  let visible = 0, total = 0, sum = 0;
  const fails = [];
  for (const s of probe.samples) {
    const a = pixel(img, s.x, s.y);
    const b = pixel(img, s.ix, s.iy);
    if (!a || !b) continue;
    total += 1;
    const c = lum(a) - lum(b);
    sum += c;
    if (c > 12) visible += 1;
    else if (fails.length < 3) fails.push({ id: s.id, edge: a, inner: b, contrast: +c.toFixed(1) });
  }
  console.log(`[${label}] districts=${probe.districts} 质心在屏内=${probe.onScreen} 采样=${total} 可见=${visible} 平均对比=${(sum / Math.max(total, 1)).toFixed(2)}`);
  console.log(`[${label}] bbox w=${probe.bbox.w.toFixed(0)} h=${probe.bbox.h.toFixed(0)} 占屏 w=${(probe.bbox.w / probe.W).toFixed(2)} h=${(probe.bbox.h / probe.H).toFixed(2)} minY=${probe.bbox.minY.toFixed(0)} maxY=${probe.bbox.maxY.toFixed(0)}`);
  console.log(`[${label}] 反例 ${JSON.stringify(fails)}`);
  return probe;
}

await measure('现状');

// 控制组：把轮廓线加粗到 8px、纯白、不透明，再量一次
await page.evaluate(() => {
  for (const [, rec] of window.__sandboxScene.districts.entries()) {
    for (const m of rec.edgeMaterials) {
      m.linewidth = 8;
      m.opacity = 1;
      m.color.setHex(0xffffff);
    }
  }
  window.__sandboxScene.setPaused(false);
});
await page.waitForTimeout(600);
await page.evaluate(() => window.__sandboxScene.setPaused(true));
await measure('加粗8px白线');

console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close();
