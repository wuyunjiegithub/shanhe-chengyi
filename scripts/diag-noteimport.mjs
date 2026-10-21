import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

await page.addInitScript(() => {
  const idx = {
    rootName: '测试照片',
    boundAt: new Date().toISOString(),
    persistent: false,
    total: 3,
    byDistrict: {
      '330127': [
        { path: '浙江省/杭州市/淳安县/千岛湖-01.jpg', name: '千岛湖-01.jpg', kind: 'image', shape: 'landscape', mtime: 1729300800000 },
        { path: '浙江省/杭州市/淳安县/千岛湖-02.jpg', name: '千岛湖-02.jpg', kind: 'image', shape: 'portrait', mtime: 1729300900000 },
        { path: '浙江省/杭州市/淳安县/村落-03.jpg', name: '村落-03.jpg', kind: 'image', shape: 'other', mtime: 1729301000000 },
      ],
    },
    byCity: {},
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(idx));
});
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);
await page.evaluate(async () => {
  const mk = (w, h, c) =>
    new Promise((resolve) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      cv.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
    });
  const blobs = {
    'blob:浙江省/杭州市/淳安县/千岛湖-01.jpg': await mk(320, 200, ['#1b5e9c', '#7ec8f2']),
    'blob:浙江省/杭州市/淳安县/千岛湖-02.jpg': await mk(200, 320, ['#9c1b5e', '#f27ec8']),
    'blob:浙江省/杭州市/淳安县/村落-03.jpg': await mk(260, 260, ['#5e9c1b', '#c8f27e']),
  };
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('ds-photolib', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      for (const [k, v] of Object.entries(blobs)) store.put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
});
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);
await page.click('.drawer-actions .ghost-btn');
await page.waitForSelector('.note-editor');
await page.waitForTimeout(300);
await page.click('.note-images-acts .ghost-btn');
await page.waitForSelector('.np-backdrop');
await page.waitForSelector('.np-cell-img img', { timeout: 6000 });

// 在页面里直接调 confirm 的依赖链：photoUrl → fetch → blob
const probe = await page.evaluate(async () => {
  const lib = window.__store_probe;
  return lib;
}).catch(() => null);

await page.locator('.np-cell').nth(0).click();
await page.locator('.np-cell').nth(2).click();
console.log('picked =', await page.locator('.np-count b').textContent());
await page.click('.np-foot .primary-btn');
await page.waitForTimeout(1200);
console.log('toast =', await page.locator('.hud-toast').count() ? await page.locator('.hud-toast').textContent() : '(none)');
console.log('note imgs =', await page.locator('.note-image-grid li').count());
console.log('picker still open =', await page.locator('.np-backdrop').count());
const cnt = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('ds-travel-images', 1);
  req.onsuccess = () => {
    try {
      const r = req.result.transaction('images', 'readonly').objectStore('images').count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve('err:' + String(r.error));
    } catch (e) { resolve('throw:' + String(e)); }
  };
  req.onerror = () => resolve('openerr');
}));
console.log('travel-images count =', cnt);
await browser.close();
