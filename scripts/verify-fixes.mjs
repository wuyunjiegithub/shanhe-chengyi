// 综合验证：悬浮不抬升 / 选中区县光点可见可点 / 光点静止 / 足迹面板
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

// ---- 1. 悬浮丽水：验证不抬升 ----
const hit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 80; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.id === '331100') {
        return { x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
});
if (hit) {
  await page.mouse.move(hit.x, hit.y, { steps: 6 });
  await page.waitForTimeout(900);
  const st = await page.evaluate(() => {
    const rec = window.__sandboxScene.cities.get('331100');
    return { hk: window.__sandboxScene.hoveredKey, targetY: rec.targetY, meshY: Math.round(rec.meshes[0].position.y * 1000) / 1000 };
  });
  console.log('1) hover lishui:', JSON.stringify(st), st.targetY === 0 && st.meshY === 0 ? 'PASS 不抬升' : 'FAIL');
  await page.screenshot({ path: path.join(OUT, 'v1-hover-nolift.png') });
  await page.mouse.move(80, 120, { steps: 6 });
  await page.waitForTimeout(500);
}

// ---- 2. 进入上海，选中一个区县，验证光点高于板面且可点击 ----
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2200);

// 找一个区县的命中点并点击选中
const dhit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 120; i++) {
    for (let j = 0; j < 80; j++) {
      const nx = (i / 119) * 2 - 1, ny = 1 - (j / 79) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.kind === 'district') {
        return { id: h.object.userData.id, x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
});
console.log('2) district hit:', JSON.stringify(dhit));
if (dhit) {
  await page.mouse.click(dhit.x, dhit.y);
  await page.waitForTimeout(1500);
  const st = await page.evaluate((did) => {
    const scene = window.__sandboxScene;
    const rec = scene.districts.get(did);
    const pins = [...scene.pins.values()].filter((p) => p.districtId === did);
    const plateTop = rec ? rec.meshes[0].position.y + rec.height : null;
    const pinYs = pins.map((p) => Math.round(p.group.position.y * 100) / 100);
    return {
      selected: scene.selectedDistrictId,
      lift: rec ? Math.round(rec.meshes[0].position.y * 100) / 100 : null,
      plateTop: plateTop !== null ? Math.round(plateTop * 100) / 100 : null,
      pinYs,
      pinAbovePlate: pins.every((p) => p.group.position.y > plateTop - 0.05),
      pinCount: pins.length,
    };
  }, dhit.id);
  console.log('   selected district state:', JSON.stringify(st));
  console.log('   ', st.selected === dhit.id && st.pinCount > 0 && st.pinAbovePlate ? 'PASS 光点在板面之上' : 'FAIL');

  // 点击该区县的一个光点，验证可交互
  const pinHit = await page.evaluate((did) => {
    const scene = window.__sandboxScene;
    const rect = scene.container.getBoundingClientRect();
    const pins = [...scene.pins.values()].filter((p) => p.districtId === did);
    for (const pin of pins) {
      const v = pin.group.position.clone();
      v.y += 0.12;
      v.project(scene.camera);
      const x = Math.round(rect.left + ((v.x + 1) / 2) * rect.width);
      const y = Math.round(rect.top + ((1 - v.y) / 2) * rect.height);
      if (x > 0 && x < 1440 && y > 0 && y < 900) return { id: pin.id, x, y };
    }
    return null;
  }, dhit.id);
  console.log('   pin screen pos:', JSON.stringify(pinHit));
  if (pinHit) {
    await page.mouse.click(pinHit.x, pinHit.y);
    await page.waitForTimeout(1200);
    const focused = await page.evaluate(() => window.__sandboxScene.focusedSpotId);
    const leaf = await page.evaluate(() => document.querySelector('.leaf-card')?.textContent?.slice(0, 30) ?? null);
    console.log('   focusedSpotId:', focused, 'leafCard:', leaf, focused === pinHit.id ? 'PASS 光点可交互' : 'FAIL');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const liftSt = await page.evaluate((did) => {
      const rec = window.__sandboxScene.districts.get(did);
      return { targetY: Math.round(rec.targetY * 100) / 100, meshY: Math.round(rec.meshes[0].position.y * 100) / 100 };
    }, dhit.id);
    console.log('   selected lift:', JSON.stringify(liftSt), liftSt.targetY > 0 ? 'PASS 选中抬升' : 'FAIL');
  }
  await page.screenshot({ path: path.join(OUT, 'v2-district-selected.png') });
}

// ---- 3. 光点静止：连续采样位置 ----
const y1 = await page.evaluate(() => [...window.__sandboxScene.pins.values()].map((p) => Math.round(p.group.position.y * 1000) / 1000).join(','));
await page.waitForTimeout(700);
const y2 = await page.evaluate(() => [...window.__sandboxScene.pins.values()].map((p) => Math.round(p.group.position.y * 1000) / 1000).join(','));
console.log('3) pin Y stable:', y1 === y2 ? 'PASS 静止' : 'FAIL', y1 === y2 ? '' : `${y1} -> ${y2}`);

// ---- 4. 足迹面板 ----
await page.locator('.fav-pill').click();
await page.waitForTimeout(600);
const sections = await page.evaluate(() =>
  [...document.querySelectorAll('.fav-panel .block-title')].map((el) => el.textContent),
);
console.log('4) fav panel sections:', JSON.stringify(sections));
await page.screenshot({ path: path.join(OUT, 'v3-fav-panel.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await browser.close();
console.log('done');
