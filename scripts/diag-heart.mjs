import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { decodePng, pixel } from './png.mjs';

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
// 收藏淳安县（造出 3D 粉心）
await page.evaluate(() => localStorage.setItem('ds.favorites.v1', JSON.stringify({ districts: ['330127'], spots: [], cities: [] })));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3200);
await page.evaluate(() => window.__sandboxScene.setPaused(true));

const heart = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const el = s.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const m = [...s.districtMarkerGroup.children].find((c) => c.userData.plateId === '330127');
  if (!m) return null;
  const wp = m.position.clone();
  m.parent.localToWorld(wp);
  const q = wp.clone().project(cam);
  return { x: (q.x * 0.5 + 0.5) * W, y: (-q.y * 0.5 + 0.5) * H, count: s.districtMarkerGroup.children.length };
});
console.log('HEART POS', JSON.stringify(heart));

const size = 120;
const clip = {
  x: Math.max(0, Math.round(heart.x - size / 2)),
  y: Math.max(0, Math.round(heart.y - size / 2)),
  width: size,
  height: size,
};
const img = decodePng(await page.screenshot({ clip }));
const pts = [];
for (let y = 0; y < img.height; y++) {
  for (let x = 0; x < img.width; x++) {
    const p = pixel(img, x, y);
    if (!p) continue;
    const [r, g, b] = p;
    if (r > 140 && b > 80 && g < 130 && b - g > 35) pts.push([x, y]);
  }
}
if (pts.length < 40) {
  console.log('未找到足够粉色像素', pts.length);
} else {
  const ys = pts.map((p) => p[1]);
  const top = Math.min(...ys), bot = Math.max(...ys);
  const third = (bot - top) / 3;
  const widthIn = (a, b) => {
    const xs = pts.filter((p) => p[1] >= a && p[1] <= b).map((p) => p[0]);
    return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  };
  const wTop = widthIn(top, top + third);
  const wBot = widthIn(bot - third, bot);
  console.log('粉色像素', pts.length, '高度', bot - top, '上1/3宽', wTop, '下1/3宽', wBot,
    '→', wTop > wBot * 1.15 ? '♥ 正常(上宽下尖)' : wBot > wTop * 1.15 ? '倒置(上尖下宽)' : '接近对称/需复核');
  // 逐行宽度剖面
  const rows = [];
  for (let y = top; y <= bot; y += Math.max(1, Math.round((bot - top) / 8))) {
    const xs = pts.filter((p) => p[1] === y).map((p) => p[0]);
    rows.push(xs.length ? Math.max(...xs) - Math.min(...xs) + 1 : 0);
  }
  console.log('自上而下逐行宽度', JSON.stringify(rows));
}
await browser.close();
