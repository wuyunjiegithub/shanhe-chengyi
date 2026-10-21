// 诊断：悬浮南部城市时的「残影」问题
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

// 找到丽水市(331100)/温州市(330300)板块的屏幕坐标
const pos = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const THREE = scene.camera.constructor;
  const out = {};
  for (const id of ['331100', '330300', '330100']) {
    const rec = scene.cities.get(id);
    if (!rec) { out[id] = null; continue; }
    const c = rec.centroid;
    const v = new (scene.camera.position.constructor)(c[0], 1, -c[1]);
    v.project(scene.camera);
    const rect = scene.container.getBoundingClientRect();
    out[id] = {
      x: Math.round(rect.left + ((v.x + 1) / 2) * rect.width),
      y: Math.round(rect.top + ((1 - v.y) / 2) * rect.height),
      meshes: rec.meshes.length,
    };
  }
  return out;
});
console.log('screen positions:', JSON.stringify(pos));

const target = pos['331100'] ?? pos['330300'];
if (target) {
  await page.screenshot({ path: path.join(OUT, 'g1-before.png') });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'g2-hover.png') });
  // 鼠标移开到画面空白处
  await page.mouse.move(60, 500, { steps: 8 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'g3-after.png') });
  // 再次悬浮，检查 hover 状态
  const hk = await page.evaluate(() => window.__sandboxScene.hoveredKey);
  console.log('hoveredKey after re-hover:', hk);
}
await browser.close();
console.log('done');
