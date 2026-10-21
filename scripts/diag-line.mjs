import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { decodePng, pixel, lum } from './png.mjs';

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
await page.waitForTimeout(3000);

// 把区县板面刷成纯黑，并隐藏背景/城市板/星点/网格/标签/pin，只留轮廓线：若线在渲染，就能数到亮像素
const meta = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  scene.cityGroup.visible = false;
  scene.stars.visible = false;
  if (scene.ground) scene.ground.visible = false;
  if (scene.grid) scene.grid.visible = false;
  scene.districtLabelGroup.visible = false;
  scene.provinceLabelGroup.visible = false;
  if (scene.pinGroup) scene.pinGroup.visible = false;
  scene.districtMarkerGroup.visible = false;
  scene.cityMarkerGroup.visible = false;
  let lines = 0;
  for (const [, rec] of scene.districts.entries()) {
    for (const p of rec.pedestals) p.visible = false;
    for (const m of rec.capMaterials) {
      m.color.setHex(0x000000);
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }
    for (const mesh of rec.meshes) {
      const l = mesh.children.find((c) => c.isLine2 || c.type === 'Line2');
      if (l) lines += 1;
    }
  }
  const first = [...scene.districts.values()][0];
  const em = first.edgeMaterials[0];
  return {
    lines,
    linewidth: em.linewidth,
    resolution: [em.resolution.x, em.resolution.y],
    opacity: em.opacity,
    transparent: em.transparent,
    worldUnits: em.worldUnits,
    visible: [...scene.districts.values()][0].meshes[0].children[0].visible,
  };
});
console.log('LINE META', JSON.stringify(meta));
await page.waitForTimeout(500);
await page.evaluate(() => {
  // 藏掉所有 DOM HUD，避免把界面文字/面板算成亮像素
  document.querySelectorAll('.shell > *').forEach((el) => {
    if (!el.classList.contains('canvas')) el.style.setProperty('display', 'none', 'important');
  });
  window.__sandboxScene.setPaused(true);
});
await page.waitForTimeout(300);

const shot = await page.screenshot();
const img = decodePng(shot);
let bright = 0;
const samples = [];
for (let y = 0; y < img.height; y += 1) {
  for (let x = 0; x < img.width; x += 1) {
    const p = pixel(img, x, y);
    if (!p) continue;
    if (lum(p) > 45) {
      bright += 1;
      if (samples.length < 5) samples.push({ x, y, p });
    }
  }
}
console.log('亮像素(板面刷黑后)', bright, '样例', JSON.stringify(samples));

// 交叉验证：把轮廓线上的点投影到屏幕，看该像素是否真的是亮线
const probe = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const cam = scene.camera;
  const el = scene.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const out = [];
  for (const [id, rec] of scene.districts.entries()) {
    const mesh = rec.meshes[0];
    const l = mesh.children.find((c) => c.isLine2 || c.type === 'Line2');
    if (!l) continue;
    const attr = l.geometry.attributes.instanceStart;
    const n = attr.count;
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += step) {
      const p = mesh.position.clone();
      p.set(attr.getX(i), attr.getY(i), attr.getZ(i));
      mesh.localToWorld(p);
      const q = p.clone().project(cam);
      out.push({ id, x: (q.x * 0.5 + 0.5) * W, y: (-q.y * 0.5 + 0.5) * H });
    }
    break; // 只看第一个区县
  }
  return out;
});
const hits = probe.map((s) => {
  const p = pixel(img, s.x, s.y);
  return { x: Math.round(s.x), y: Math.round(s.y), p, lum: p ? +lum(p).toFixed(0) : null };
});
console.log('轮廓点像素', JSON.stringify(hits));
await browser.close();
