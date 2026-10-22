/** 诊断：索引注入是否生效 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://127.0.0.1:1422/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 最小注入：只写 index，不写 blob
await pc.addInitScript(() => {
  const index = {
    rootName: '本地照片',
    boundAt: new Date().toISOString(),
    persistent: false,
    total: 2,
    byDistrict: {},
    byCity: {
      '330100': [
        { path: '浙江省/杭州市/007-城市全景.jpg', name: '007-城市全景.jpg', kind: 'image', shape: 'other', mtime: Date.now() },
        { path: '浙江省/杭州市/008-龙井问茶.jpg', name: '008-龙井问茶.jpg', kind: 'image', shape: 'landscape', mtime: Date.now() },
      ],
    },
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(index));
});

await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(2500);

const st = await pc.evaluate(() => {
  const raw = localStorage.getItem('ds.photoLib.index.v1');
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  return {
    rawLen: raw ? raw.length : 0,
    total: parsed?.total ?? null,
    cityKeys: parsed ? Object.keys(parsed.byCity ?? {}) : [],
    cityCount: parsed?.byCity?.['330100']?.length ?? 0,
  };
});
console.log('注入后 localStorage:', JSON.stringify(st));

await pc.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州 · 照片墙' }),
);
await pc.waitForTimeout(2500);
const dom = await pc.evaluate(() => ({
  title: document.querySelector('.wall-title')?.textContent ?? null,
  count: document.querySelectorAll('.wall-tile').length,
  empty: document.querySelectorAll('.wall-media--empty').length,
  imgs: [...document.querySelectorAll('.wall-media-img')].map((i) => ({
    ok: i.complete && i.naturalWidth > 0,
    src: String(i.src).slice(0, 40),
  })),
}));
console.log('照片墙 DOM:', JSON.stringify(dom, null, 1));
await browser.close();
