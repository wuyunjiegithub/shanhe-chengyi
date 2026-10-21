// 诊断5：高频截图序列捕捉悬浮动画过程
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots/seq');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);

const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  const pts = [];
  for (let i = 0; i < 120 && pts.length < 1; i++) {
    for (let j = 0; j < 80 && pts.length < 1; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === '330300') {
        pts.push({ x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) });
      }
    }
  }
  return pts[0] ?? null;
});
console.log('wenzhou hit:', JSON.stringify(hit));
if (!hit) { await browser.close(); process.exit(1); }

// 从板块上方缓慢移入，同时高频截图
await page.mouse.move(hit.x, hit.y - 160, { steps: 3 });
await page.waitForTimeout(300);
const frames = [];
for (let f = 0; f < 24; f++) {
  await page.mouse.move(hit.x, hit.y - 160 + Math.round((f / 23) * 160), { steps: 1 });
  await page.screenshot({ path: path.join(OUT, `f${String(f).padStart(2, '0')}.png`) });
  const st = await page.evaluate(() => {
    const rec = window.__sandboxScene.cities.get('330300');
    return rec ? { hk: window.__sandboxScene.hoveredKey, y: Math.round(rec.meshes[0].position.y * 100) / 100 } : null;
  });
  frames.push(st);
}
console.log('frames:', JSON.stringify(frames));
await browser.close();
console.log('done');
