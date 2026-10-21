// 诊断 3：基座修复后的状态 + 悬停抬升时基座是否正常「长高」
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
const page = await browser.newPage({ viewport: { width: 1080, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.resetCamera());
await page.waitForTimeout(1500);

const rest = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const rows = [];
  for (const [id, rec] of S.cities) for (const p of rec.pedestals) rows.push([id, p.scale.x, p.scale.y, p.scale.z]);
  const badY = rows.filter((r) => Math.abs(r[2] - 1) > 0.01).length;
  const zs = rows.map((r) => r[3]);
  return { total: rows.length, badY, zMin: Math.min(...zs), zMax: Math.max(...zs) };
});
console.log('静止态基座:', JSON.stringify(rest));

await page.screenshot({ path: path.join(OUT, 'c6-no-line-home.png') });

// 悬停某个城市板块中心 → 抬升，观察基座
const hover = await page.evaluate(async () => {
  const S = window.__sandboxScene;
  // 找南京（320100）
  const rec = S.cities.get('320100');
  const m = rec.meshes[0];
  const el = S.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const v = S.camera.position.clone();
  v.set(rec.centroid[0], rec.height, -rec.centroid[1]).project(S.camera);
  return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
});
await page.mouse.move(hover.x, hover.y);
await page.waitForTimeout(900);
const lifted = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const rec = S.cities.get('320100');
  const p = rec.pedestals[0];
  return {
    targetY: +rec.targetY.toFixed(2),
    plateY: +rec.meshes[0].position.y.toFixed(2),
    pedScale: [+p.scale.x.toFixed(3), +p.scale.y.toFixed(3), +p.scale.z.toFixed(3)],
    hovered: S.hoveredKey,
  };
});
console.log('悬停南京:', JSON.stringify(lifted));
await page.screenshot({ path: path.join(OUT, 'c7-hover-pedestal.png') });

// 城市视图（上海）看区县基座
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1800);
const districtPed = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const rows = [];
  for (const rec of S.districts.values()) for (const p of rec.pedestals) rows.push([p.scale.x, p.scale.y, p.scale.z]);
  return { total: rows.length, badY: rows.filter((r) => Math.abs(r[1] - 1) > 0.01).length };
});
console.log('区县基座:', JSON.stringify(districtPed));
await page.screenshot({ path: path.join(OUT, 'c8-shanghai-districts.png') });

// 返回省视角
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'c9-back-region.png') });

console.log('ERRORS', JSON.stringify(errors.slice(0, 5)));
await browser.close();
