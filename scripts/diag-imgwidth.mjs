// 调试：插入图片后 width 属性为什么没被写上
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const stub = () => {
  const SIZE_BY_URI = {
    'content://media/external/images/media/11': [240, 320],
    'content://media/external/images/media/12': [1080, 1440],
    'content://media/external/images/media/13': [800, 600],
    'content://media/external/images/media/14': [300, 300],
    'content://media/external/images/media/15': [200, 200],
    'content://media/external/images/media/21': [900, 1200],
    'content://media/external/images/media/22': [1200, 900],
  };
  const SIZE_BY_PATH = {
    '/DCIM/Camera/a.jpg': [240, 320],
    '/DCIM/Camera/b.jpg': [1080, 1440],
    '/DCIM/Camera/c.jpg': [800, 600],
  };
  const pngUrl = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f43f5e'); g.addColorStop(1, '#0ea5e9');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c.toDataURL('image/png');
  };
  const urlToBytes = (url) => {
    const bin = atob(url.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  const photos = [
    { id: 11, bucket: '淳安县', name: '小图-竖版.jpg', path: '/DCIM/Camera/a.jpg', uri: 'content://media/external/images/media/11', mtime: 1700000000000, width: 240, height: 320, mime: 'image/jpeg' },
    { id: 12, bucket: '淳安县', name: '大图-竖版.jpg', path: '/DCIM/Camera/b.jpg', uri: 'content://media/external/images/media/12', mtime: 1700000100000, width: 1080, height: 1440, mime: 'image/jpeg' },
    { id: 13, bucket: '淳安县', name: '中图-横版.jpg', path: '/DCIM/Camera/c.jpg', uri: 'content://media/external/images/media/13', mtime: 1700000200000, width: 800, height: 600, mime: 'image/jpeg' },
    { id: 14, bucket: '淳安县', name: '无路径图A.jpg', path: '', uri: 'content://media/external/images/media/14', mtime: 1700000250000, width: 300, height: 300, mime: 'image/jpeg' },
    { id: 15, bucket: '淳安县', name: '无路径图B.jpg', path: '', uri: 'content://media/external/images/media/15', mtime: 1700000260000, width: 200, height: 200, mime: 'image/jpeg' },
  ];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'media_permission_state': return true;
        case 'media_request_permission': return true;
        case 'media_list_albums': return [{ name: '淳安县', count: 5 }];
        case 'media_all_photos': return photos;
        case 'media_album_photos': return photos.filter((p) => p.bucket === args?.album);
        case 'media_photo_bytes': {
          const size = SIZE_BY_URI[args?.uri] || [1200, 900];
          return urlToBytes(pngUrl(size[0], size[1]));
        }
        case 'plugin:app|registerListener': return 0;
        default: throw new Error(`unstubbed invoke: ${cmd}`);
      }
    },
    convertFileSrc: (p) => {
      const size = SIZE_BY_PATH[p];
      return size ? pngUrl(size[0], size[1]) : pngUrl(1200, 900);
    },
  };
  // 埋点：记录每个 img 的 load 事件与 width 属性变化
  window.__imgLog = [];
  const origCreate = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === 'img') {
      el.addEventListener('load', () => {
        window.__imgLog.push({ ev: 'load', w: el.getAttribute('width'), nat: el.naturalWidth });
      });
    }
    return el;
  };
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA_ANDROID,
});
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(stub);
await page.goto('http://localhost:1420/', { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3200);

await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(500);

await page.click('.rt-btn--img');
await page.waitForSelector('.np-backdrop', { timeout: 6000 });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.np-cell')].find((c) => (c.querySelector('.np-cell-name')?.textContent || '') === '小图-竖版.jpg');
  cell?.click();
});
await page.waitForTimeout(200);
await page.click('.np-insert-btn');

for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => {
    const i = document.querySelector('.rt-body img[data-img]');
    return i
      ? { w: i.getAttribute('width'), complete: i.complete, nat: i.naturalWidth, fitted: i.dataset.fitted, src: (i.getAttribute('src') || '').slice(0, 24) }
      : null;
  });
  console.log(i, JSON.stringify(st));
}
console.log('imgLog:', JSON.stringify(await page.evaluate(() => window.__imgLog)));
await browser.close();
