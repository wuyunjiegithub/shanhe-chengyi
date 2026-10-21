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

const pts = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const el = s.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const out = [];
  for (const [id, rec] of s.districts.entries()) {
    const p = cam.position.clone();
    p.set(rec.centroid[0], rec.height, -rec.centroid[1]);
    const q = p.clone().project(cam);
    out.push({ id, x: (q.x * 0.5 + 0.5) * W, y: (-q.y * 0.5 + 0.5) * H });
  }
  // 城市板块质心
  const c = s.cities.get('330100');
  let cityPt = null;
  if (c) {
    const p = cam.position.clone();
    p.set(c.centroid[0], c.height, -c.centroid[1]);
    const q = p.clone().project(cam);
    cityPt = { x: (q.x * 0.5 + 0.5) * W, y: (-q.y * 0.5 + 0.5) * H };
  }
  return { out, cityPt };
});

await page.evaluate(() => window.__sandboxScene.setPaused(true));
const a = decodePng(await page.screenshot());
const withCity = pts.out.slice(0, 6).map((p) => ({ id: p.id, px: pixel(a, p.x, p.y) }));
const cityPx = pts.cityPt ? pixel(a, pts.cityPt.x, pts.cityPt.y) : null;

await page.evaluate(() => {
  window.__sandboxScene.cityGroup.visible = false;
  window.__sandboxScene.setPaused(false);
});
await page.waitForTimeout(500);
await page.evaluate(() => window.__sandboxScene.setPaused(true));
const b = decodePng(await page.screenshot());
const noCity = pts.out.slice(0, 6).map((p) => ({ id: p.id, px: pixel(b, p.x, p.y) }));

console.log('城市板质心像素', JSON.stringify(cityPx));
for (let i = 0; i < withCity.length; i++) {
  console.log(withCity[i].id, '有城市板', JSON.stringify(withCity[i].px), '隐藏城市板', JSON.stringify(noCity[i].px));
}
await browser.close();
