import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
m.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 15000 });
await m.waitForTimeout(1200);

// 复用上一轮已注入的索引（localStorage 同源，但 mobile 是独立上下文，需要重新注入一次）
await m.evaluate(async () => {
  const mk = async (i) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 427;
    const g = c.getContext('2d');
    g.fillStyle = ['#e11d48', '#0ea5e9', '#f59e0b'][i % 3];
    g.fillRect(0, 0, 640, 427);
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
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
  for (let i = 0; i < 6; i++) {
    const p = `上海市/徐汇区/IMG_00${i}.jpg`;
    const blob = await mk(i);
    await new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(blob, 'blob:' + p);
      tx.oncomplete = () => res();
    });
    entries.push({ path: p, name: `IMG_00${i}.jpg`, kind: 'image', shape: 'landscape', mtime: Date.now() - i * 86400000 });
  }
  db.close();
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify({
    rootName: 'photos', boundAt: new Date().toISOString(), persistent: false, total: 6,
    byDistrict: { '310104': entries }, byCity: {},
  }));
});
await m.reload({ waitUntil: 'networkidle' });
await m.waitForTimeout(1500);
await m.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(800);
const clicked = await m.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  if (b) { b.click(); return b.textContent.trim(); }
  return null;
});
await m.waitForTimeout(2000);
const st = await m.evaluate(() => {
  const modal = document.querySelector('.wall-modal');
  const r = modal?.getBoundingClientRect();
  const imgs = [...document.querySelectorAll('.wall-tile img')];
  return {
    modal: modal ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
    tiles: document.querySelectorAll('.wall-tile').length,
    imgs: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    empty: !!document.querySelector('.wall-empty'),
    css: modal ? getComputedStyle(modal).height : null,
  };
});
console.log("clicked=", clicked);
console.log(JSON.stringify(st, null, 1));
await m.screenshot({ path: 'regression-shots/diag-mobile-wall.png' });
await browser.close();
