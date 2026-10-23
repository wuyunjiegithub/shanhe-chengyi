// 调试：淳安县相册索引落地情况
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(() => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const photos = [
    { id: 11, bucket: '淳安县', name: '千岛湖1.jpg', path: '/DCIM/Camera/1.jpg', uri: 'content://media/external/images/media/11', mtime: 1700000000000, width: 4032, height: 3024, mime: 'image/jpeg' },
    { id: 12, bucket: '淳安县', name: '千岛湖2.jpg', path: '', uri: 'content://media/external/images/media/12', mtime: 1700000100000, width: 1080, height: 1920, mime: 'image/jpeg' },
    { id: 13, bucket: '淳安县', name: '千岛湖3.jpg', path: '/DCIM/Camera/3.jpg', uri: 'content://media/external/images/media/13', mtime: 1700000200000, width: 4032, height: 3024, mime: 'image/jpeg' },
  ];
  const bin = atob(PNG);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      if (cmd === 'media_permission_state' || cmd === 'media_request_permission') return true;
      if (cmd === 'media_list_albums') return [{ name: '淳安县', count: 3 }];
      if (cmd === 'media_all_photos') return photos;
      if (cmd === 'media_album_photos') return photos.filter((p) => p.bucket === args?.album);
      if (cmd === 'media_photo_bytes') return bytes.buffer;
      throw new Error('unstubbed: ' + cmd);
    },
    convertFileSrc: (p) => `asset://localhost/${encodeURIComponent(p)}`,
  };
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3000);

const idx = await page.evaluate(() => {
  const raw = localStorage.getItem('ds.photoLib.index.v1');
  return raw ? JSON.parse(raw) : null;
});
console.log('持久化索引 byDistrict:', JSON.stringify(idx?.byDistrict, null, 1));
console.log('total:', idx?.total, 'rootName:', idx?.rootName);

await page.evaluate(() => window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }));
await page.waitForSelector('.wall-modal', { timeout: 8000 });
await page.waitForTimeout(1500);
const wall = await page.evaluate(() => ({
  count: document.querySelector('.wall-count')?.textContent,
  tiles: document.querySelectorAll('.wall-tile').length,
  chips: [...document.querySelectorAll('.wall-shape-chip')].map((c) => c.textContent),
  tipExists: !!document.querySelector('.wall-media-tip'),
}));
console.log('墙状态:', JSON.stringify(wall));
await browser.close();
