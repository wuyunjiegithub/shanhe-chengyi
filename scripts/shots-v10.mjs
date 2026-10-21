// v1.0 截图：3D 照片空间（相框）、聚焦稳定态、查看器（缩放/旋转）、移动端抽屉
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
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });

// 注入 8 张照片
await page.evaluate(async () => {
  const mkBlob = async (w, h, color) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.fillRect(14, 14, w - 28, h - 28);
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    g.fillRect(30, 30, w - 60, h - 60);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  };
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open('ds-photolib', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const plan = [
    [40, 160, 220],
    [200, 40, 60],
    [240, 200, 40],
    [60, 200, 120],
    [180, 90, 220],
    [230, 120, 60],
    [90, 110, 230],
    [220, 220, 120],
  ];
  const entries = [];
  for (let i = 0; i < plan.length; i++) {
    const name = `p${i + 1}.jpg`;
    const p = `上海市/黄浦区/${name}`;
    const blob = await mkBlob(320, 200, plan[i]);
    await new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(blob, 'blob:' + p);
      tx.oncomplete = () => res();
    });
    entries.push({ path: p, name, kind: 'image', shape: 'landscape', mtime: Date.UTC(2024, 0, 10 + i) });
  }
  db.close();
  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({ rootName: 'photos', boundAt: new Date().toISOString(), persistent: false, total: entries.length, byDistrict: { '310104': entries }, byCity: {} }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForSelector('.wall-modal', { timeout: 5000 });
await page.waitForTimeout(1000);

// 1) 3D 照片空间全景（相框）
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.wall-style-chip')].find((b) => b.textContent.includes('3D'));
  chip && chip.click();
});
await page.waitForTimeout(3500);
await page.screenshot({ path: path.join(OUT, 'v10-space-frames.png') });

// 2) 聚焦态：网格扫描命中一张，飞抵后截图（应完全静止）
const box = await page.locator('.hall3d canvas').boundingBox();
let hit = false;
if (box) {
  outer: for (let gy = 2; gy <= 4 && !hit; gy += 1) {
    for (let gx = 2; gx <= 4; gx += 1) {
      await page.mouse.click(box.x + (box.width * gx) / 6, box.y + (box.height * gy) / 6);
      await page.waitForTimeout(1300);
      hit = await page.evaluate(() => !!document.querySelector('.hall3d-zoom'));
      if (hit) break outer;
    }
  }
}
if (hit) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'v10-space-focused.png') });
  // 3) 查看器：放大 + 旋转后截图
  await page.evaluate(() => document.querySelector('.hall3d-zoom')?.click());
  await page.waitForSelector('.pv-backdrop', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const zoomBtn = [...document.querySelectorAll('.pv-tools button')].find((b) => b.getAttribute('aria-label') === '放大');
    zoomBtn && zoomBtn.click();
    zoomBtn && zoomBtn.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'v10-viewer-zoom.png') });
  await page.evaluate(() => {
    const rot = [...document.querySelectorAll('.pv-tools button')].find((b) => b.getAttribute('aria-label') === '右转');
    rot && rot.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'v10-viewer-rotate.png') });
}

// 4) 城市面板（写游记 + 到访时间）：先彻底关掉照片墙再下钻
await page.evaluate(() => {
  const b = document.querySelector('.wall-close');
  b && b.click();
});
await page.waitForTimeout(700);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(OUT, 'v10-city-panel.png') });

// 5) 移动端抽屉滚动态
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 15000 });
await m.waitForTimeout(1500);
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 });
await m.waitForTimeout(1200);
const sc = await m.locator('.drawer-scroll').boundingBox();
if (sc) {
  await m.mouse.move(sc.x + sc.width / 2, sc.y + sc.height * 0.7);
  await m.mouse.wheel(0, 500);
  await m.waitForTimeout(700);
}
await m.screenshot({ path: path.join(OUT, 'v10-mobile-scrolled.png') });

await browser.close();
console.log('shots done');
