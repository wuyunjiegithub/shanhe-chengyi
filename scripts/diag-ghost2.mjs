// 诊断2：网格扫描命中丽水板块，观察悬浮时的渲染差异
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
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);

// 网格扫描：找能命中 city:331100 的屏幕坐标
const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  const found = [];
  for (let gx = -0.5; gx <= 0.5; gx += 0.05) {
    for (let gy = -0.4; gy <= 0.4; gy += 0.05) {
      const nx = gx, ny = gy;
      // 以丽水质心为基准
      const rec = scene.cities.get('331100');
      if (!rec) return null;
      const c = rec.centroid;
      const v = new (scene.camera.position.constructor)(c[0], 1, -c[1]);
      v.project(scene.camera);
      const cx = (v.x + 1) / 2, cy = (1 - v.y) / 2;
      const x = cx + gx * 0.15, y = cy + gy * 0.15;
      const h = scene.pick(x * 2 - 1, y * 2 - 1);
      if (h && h.object.userData.id === '331100') {
        found.push({
          x: Math.round(rect.left + x * rect.width),
          y: Math.round(rect.top + y * rect.height),
        });
      }
    }
  }
  return found;
});
console.log('hit points:', JSON.stringify(hit?.slice(0, 6)));

if (hit && hit.length) {
  const p = hit[Math.floor(hit.length / 2)];
  await page.screenshot({ path: path.join(OUT, 'h1-before.png') });
  await page.mouse.move(p.x, p.y, { steps: 10 });
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    hoveredKey: window.__sandboxScene.hoveredKey,
    targetY: window.__sandboxScene.cities.get('331100')?.targetY,
    meshY: window.__sandboxScene.cities.get('331100')?.meshes.map((m) => Math.round(m.position.y * 1000) / 1000),
    pedY: window.__sandboxScene.cities.get('331100')?.pedestals.map((m) => Math.round(m.scale.y * 1000) / 1000),
  }));
  console.log('hover state:', JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'h2-hover.png') });
  // 截图后把鼠标移到左上空白
  await page.mouse.move(80, 120, { steps: 10 });
  await page.waitForTimeout(1200);
  const st2 = await page.evaluate(() => ({
    hoveredKey: window.__sandboxScene.hoveredKey,
    meshY: window.__sandboxScene.cities.get('331100')?.meshes.map((m) => Math.round(m.position.y * 1000) / 1000),
  }));
  console.log('after move:', JSON.stringify(st2));
  await page.screenshot({ path: path.join(OUT, 'h3-after.png') });
}
await browser.close();
console.log('done');
