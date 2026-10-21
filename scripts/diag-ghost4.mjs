// 诊断4：录制悬浮南部城市的过程视频
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
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);

// 找温州(330300)命中点（22 meshes 的多环城市，在地图最底部）
const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  const pts = [];
  for (let i = 0; i < 120 && pts.length < 3; i++) {
    for (let j = 0; j < 80 && pts.length < 3; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === '330300') {
        pts.push({ x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) });
      }
    }
  }
  return pts;
});
console.log('wenzhou hits:', JSON.stringify(hit));

if (hit && hit.length) {
  const p = hit[hit.length - 1]; // 最南部的点
  console.log('using point', JSON.stringify(p));
  await page.waitForTimeout(500);
  await page.mouse.move(p.x, p.y - 100, { steps: 4 });   // 从上方进入
  await page.waitForTimeout(400);
  await page.mouse.move(p.x, p.y, { steps: 20 });        // 缓慢移入板块
  await page.waitForTimeout(1500);
  await page.mouse.move(p.x, p.y + 150, { steps: 20 });  // 缓慢下移出板块
  await page.waitForTimeout(1500);
  await page.mouse.move(p.x - 300, p.y - 200, { steps: 20 }); // 移开
  await page.waitForTimeout(1200);
}
await ctx.close();
console.log('video done');
