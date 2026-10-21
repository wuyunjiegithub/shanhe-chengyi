// 诊断6：点击上海后观察区县板块 Y 坐标是否持续起伏
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

// 点击左侧索引里的上海市
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'sh1-city.png') });

// 采样区县板块 Y 坐标
const samples = [];
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => {
    const scene = window.__sandboxScene;
    const out = {};
    for (const [id, rec] of scene.districts) {
      out[id] = Math.round(rec.meshes[0].position.y * 1000) / 1000;
    }
    return { n: scene.districts.size, ys: out, sel: scene.selectedDistrictId };
  });
  samples.push(s);
  await page.waitForTimeout(250);
}
console.log('districts:', samples[0].n, 'selected:', samples[0].sel);
const ids = Object.keys(samples[0].ys);
for (const id of ids.slice(0, 6)) {
  console.log(id, samples.map((s) => s.ys[id]).join(' '));
}
// 悬浮一个区县看是否触发变化
const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  const first = scene.districts.keys().next().value;
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 80; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === first) {
        return { id: first, x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
});
console.log('district hit:', JSON.stringify(hit));
if (hit) {
  await page.mouse.move(hit.x, hit.y, { steps: 5 });
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({
    hk: window.__sandboxScene.hoveredKey,
    ys: Object.fromEntries([...window.__sandboxScene.districts].slice(0, 4).map(([id, r]) => [id, Math.round(r.meshes[0].position.y * 1000) / 1000])),
  }));
  console.log('after hover:', JSON.stringify(st));
  await page.screenshot({ path: path.join(OUT, 'sh2-hover-district.png') });
}
await browser.close();
console.log('done');
