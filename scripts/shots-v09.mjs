// v0.9 视觉抽查：3D 照片空间（多图）+ 移动端布局
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

const seed = async (page, count) => {
  await page.evaluate(async (n) => {
    const palette = ['#e11d48', '#0ea5e9', '#f59e0b', '#22c55e', '#a855f7', '#f43f5e', '#14b8a6'];
    const mk = async (i) => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 427;
      const g = c.getContext('2d');
      const bg = palette[i % palette.length];
      g.fillStyle = bg;
      g.fillRect(0, 0, 640, 427);
      g.globalAlpha = 0.22;
      g.fillStyle = '#000';
      for (let k = 0; k < 6; k++) g.fillRect(0, k * 72, 640, 26);
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.font = '700 120px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1).padStart(2, '0'), 320, 214);
      return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
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
    const entries = [];
    for (let i = 0; i < n; i++) {
      const p = `上海市/徐汇区/IMG_${String(i + 1).padStart(3, '0')}.jpg`;
      const blob = await mk(i);
      await new Promise((res) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(blob, 'blob:' + p);
        tx.oncomplete = () => res();
      });
      entries.push({
        path: p,
        name: `IMG_${String(i + 1).padStart(3, '0')}.jpg`,
        kind: 'image',
        shape: i % 5 === 0 ? 'portrait' : 'landscape',
        mtime: Date.UTC(2024, 0, 1) + i * 86400000,
      });
    }
    db.close();
    localStorage.setItem(
      'ds.photoLib.index.v1',
      JSON.stringify({
        rootName: 'photos',
        boundAt: new Date().toISOString(),
        persistent: false,
        total: entries.length,
        byDistrict: { '310104': entries },
        byCity: {},
      }),
    );
  }, count);
};

/* ---------- 桌面：3D 照片空间 ---------- */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1200);
await seed(page, 24);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForTimeout(1400);
await page.click('.wall-close');
await page.waitForTimeout(600);
// 直接从城市面板重新打开，避免抽屉被关掉
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  [...document.querySelectorAll('.wall-style-chip')].find((b) => b.textContent.includes('3D'))?.click();
});
await page.waitForTimeout(3200);
await page.screenshot({ path: path.join(OUT, 'v09-space-desktop.png') });
await page.locator('.hall3d').screenshot({ path: path.join(OUT, 'v09-space-only.png') });

/* ---------- 移动端 ---------- */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 15000 });
await m.waitForTimeout(1200);
await seed(m, 24);
await m.reload({ waitUntil: 'networkidle' });
await m.waitForTimeout(1600);
await m.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(1000);
await m.screenshot({ path: path.join(OUT, 'v09-mobile-drawer.png') });

await m.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await m.waitForTimeout(1600);
await m.screenshot({ path: path.join(OUT, 'v09-mobile-wall.png') });
await m.evaluate(() => {
  [...document.querySelectorAll('.wall-style-chip')].find((b) => b.textContent.includes('3D'))?.click();
});
await m.waitForTimeout(3000);
await m.screenshot({ path: path.join(OUT, 'v09-mobile-space.png') });

/* 城市面板（移动端） */
await m.evaluate(() => {
  const c = document.querySelector('.wall-close');
  c && c.click();
});
await m.waitForTimeout(600);
await m.evaluate(() => window.__sandboxApp.backToRegion());
await m.waitForTimeout(1400);
await m.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await m.waitForTimeout(1800);
await m.screenshot({ path: path.join(OUT, 'v09-mobile-city2.png') });

await browser.close();
console.log('shots done');
