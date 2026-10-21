// 诊断3：用全屏网格找命中点，悬浮丽水/温州，对比渲染状态与截图
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

const findHit = await page.evaluate((id) => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 80; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === id) {
        return { x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
}, '331100');
console.log('lishui hit point:', JSON.stringify(findHit));

if (findHit) {
  await page.screenshot({ path: path.join(OUT, 'k1-before.png') });
  await page.mouse.move(findHit.x, findHit.y, { steps: 6 });
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => {
    const rec = window.__sandboxScene.cities.get('331100');
    return {
      hoveredKey: window.__sandboxScene.hoveredKey,
      targetY: rec.targetY,
      meshY: rec.meshes.map((m) => Math.round(m.position.y * 100) / 100),
      pedScaleY: rec.pedestals.map((m) => Math.round(m.scale.y * 100) / 100),
    };
  });
  console.log('hover state:', JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'k2-hover.png') });
  // 关键：把鼠标垂直下移出板块（模拟用户鼠标往下移），看残影
  await page.mouse.move(findHit.x, findHit.y + 130, { steps: 6 });
  await page.waitForTimeout(1000);
  const st2 = await page.evaluate(() => {
    const rec = window.__sandboxScene.cities.get('331100');
    return {
      hoveredKey: window.__sandboxScene.hoveredKey,
      targetY: rec.targetY,
      meshY: rec.meshes.map((m) => Math.round(m.position.y * 100) / 100),
      pedScaleY: rec.pedestals.map((m) => Math.round(m.scale.y * 100) / 100),
    };
  });
  console.log('after move down:', JSON.stringify(st2));
  await page.screenshot({ path: path.join(OUT, 'k3-movedown.png') });
}
await browser.close();
console.log('done');
