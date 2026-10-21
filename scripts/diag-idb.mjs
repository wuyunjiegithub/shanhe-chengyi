import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 1) 复刻 imageStore.saveImage 的顺序写两次
const r = await page.evaluate(async () => {
  const log = [];
  const DB_NAME = 'ds-travel-images';
  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const saveImage = async (name) => {
    const t0 = performance.now();
    const db = await openDb();
    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 30;
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite');
        const req = tx.objectStore('images').put({ id: `x-${name}-${Math.random()}`, blob, name, type: 'image/jpeg', createdAt: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
    return Math.round(performance.now() - t0);
  };
  const withTimeout = (p, ms, tag) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${tag}`)), ms))]);
  try {
    log.push(['#1', await withTimeout(saveImage('a'), 3000, 'save1')]);
    log.push(['#2', await withTimeout(saveImage('b'), 3000, 'save2')]);
    log.push(['#3', await withTimeout(saveImage('c'), 3000, 'save3')]);
  } catch (e) {
    log.push(['ERR', String(e)]);
  }
  return log;
});
console.log('sequential saveImage:', JSON.stringify(r));

// 2) 并发两次 openDb 会怎样
const r2 = await page.evaluate(async () => {
  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open('ds-conc-test', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const t0 = performance.now();
  const [a, b] = await Promise.all([openDb(), openDb()]);
  a.close();
  b.close();
  return Math.round(performance.now() - t0);
});
console.log('concurrent openDb ms:', r2);
await browser.close();
