import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

async function probe(label, url) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(url.includes('1420') ? 2500 : 200);
  const r = await page.evaluate(async () => {
    const t = (label) => ({ label, t0: performance.now() });
    const out = [];
    const step = async (name, fn, ms = 3000) => {
      const t0 = performance.now();
      try {
        await Promise.race([
          fn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms)),
        ]);
        out.push([name, Math.round(performance.now() - t0)]);
      } catch (e) {
        out.push([name, `ERR ${String(e)}`]);
      }
    };
    await step('openDb', () => new Promise((resolve, reject) => {
      const req = indexedDB.open('ds-timing', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('s', { keyPath: 'id' });
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    }));
    await step('toBlob', () => new Promise((resolve) => {
      const cv = document.createElement('canvas');
      cv.width = 40; cv.height = 30;
      cv.toBlob((b) => resolve(b), 'image/jpeg', 0.8);
    }));
    let blob = null;
    await step('openDb2+put', () => new Promise((resolve, reject) => {
      const req = indexedDB.open('ds-timing', 1);
      req.onsuccess = () => {
        const db = req.result;
        const cv = document.createElement('canvas');
        cv.width = 40; cv.height = 30;
        cv.toBlob((b) => {
          blob = b;
          const tx = db.transaction('s', 'readwrite');
          const r2 = tx.objectStore('s').put({ id: `k-${Math.random()}`, blob: b });
          r2.onsuccess = () => { db.close(); resolve(); };
          r2.onerror = () => reject(r2.error);
        }, 'image/jpeg', 0.8);
      };
      req.onerror = () => reject(req.error);
    }));
    return out;
  });
  console.log(label, JSON.stringify(r));
  await page.close();
}

await probe('blank-page', 'about:blank');
await probe('app-page', 'http://127.0.0.1:1420/');
await browser.close();
