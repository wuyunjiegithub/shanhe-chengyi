/** 手册配图：照片墙 + 3D 星系（索引用同步 initScript，blob 在页面上下文补写） */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://127.0.0.1:1422/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

/* 同步注入索引（无 IndexedDB，诊断验证过可行） */
const SEED_INDEX = () => {
  const mk = (n, name, shape) => ({
    path: `浙江省/杭州市/${n <= 4 ? '西湖区/' : ''}${name}`,
    name,
    kind: 'image',
    shape,
    mtime: Date.now() - n * 86400000,
  });
  const index = {
    rootName: '本地照片',
    boundAt: new Date().toISOString(),
    persistent: false,
    total: 8,
    byDistrict: {
      '330106': [
        mk(1, '001-西湖日落.jpg', 'landscape'),
        mk(2, '002-苏堤春晓.jpg', 'landscape'),
        mk(3, '003-雷峰夕照.jpg', 'landscape'),
        mk(4, '004-灵隐禅意.jpg', 'landscape'),
      ],
    },
    byCity: {
      '330100': [
        mk(5, '005-钱江夜色.jpg', 'portrait'),
        mk(6, '006-河坊街巷.jpg', 'portrait'),
        mk(7, '007-城市全景.jpg', 'other'),
        mk(8, '008-龙井问茶.jpg', 'landscape'),
      ],
    },
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(index));
};

/* 页面上下文里画 8 张「风景照」并写入 IndexedDB blob 缓存 */
const PAINT_AND_STORE = async () => {
  const DB = 'ds-photolib';
  const STORE = 'handles';

  function paint(w, h, sky, hills, sun) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, sky[0]);
    grad.addColorStop(0.55, sky[1]);
    grad.addColorStop(1, sky[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = sun;
    g.beginPath();
    g.arc(w * 0.72, h * 0.26, Math.min(w, h) * 0.075, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.5;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(w * (0.2 + i * 0.28), h * (0.16 + i * 0.05), w * 0.14, h * 0.02, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const layers = [
      { color: hills[0], base: 0.62, amp: 0.1 },
      { color: hills[1], base: 0.74, amp: 0.08 },
      { color: hills[2], base: 0.86, amp: 0.05 },
    ];
    for (const L of layers) {
      g.fillStyle = L.color;
      g.beginPath();
      g.moveTo(0, h);
      let x = 0;
      let y = h * L.base;
      while (x <= w) {
        g.lineTo(x, y);
        x += w / 6;
        y = h * (L.base - Math.random() * L.amp);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 0.25;
    g.fillStyle = '#bfe3ff';
    g.fillRect(0, h * 0.88, w, h * 0.12);
    g.globalAlpha = 1;
    return c;
  }

  const shots = [
    { name: '001-西湖日落.jpg', w: 1600, h: 1000, sky: ['#2b3a67', '#c96f4a', '#f2b879'], hills: ['#2a2f45', '#1f2436', '#171b29'], sun: '#ffe6b0' },
    { name: '002-苏堤春晓.jpg', w: 1600, h: 1000, sky: ['#7fb2d9', '#cfe4f2', '#f6e7c8'], hills: ['#5d7a5a', '#3f5a44', '#2c4232'], sun: '#fff6d8' },
    { name: '003-雷峰夕照.jpg', w: 1600, h: 1000, sky: ['#3d2f5f', '#a45a7a', '#e89a72'], hills: ['#33284a', '#241d38', '#181327'], sun: '#ffd9a0' },
    { name: '004-灵隐禅意.jpg', w: 1600, h: 1000, sky: ['#4a6b52', '#8fae86', '#dfe8cf'], hills: ['#33502f', '#223a24', '#16281a'], sun: '#f0ffd9' },
    { name: '005-钱江夜色.jpg', w: 1000, h: 1600, sky: ['#101a30', '#1d2f52', '#3a5a8c'], hills: ['#0e1526', '#0a1020', '#070b16'], sun: '#cfe0ff' },
    { name: '006-河坊街巷.jpg', w: 1000, h: 1600, sky: ['#5a3a2e', '#a86b4a', '#e0b184'], hills: ['#3d2820', '#2a1c16', '#1c130f'], sun: '#ffe2b8' },
    { name: '007-城市全景.jpg', w: 1400, h: 1400, sky: ['#274060', '#5b82ab', '#c8d8e8'], hills: ['#1c2c44', '#141f33', '#0d1524'], sun: '#eaf4ff' },
    { name: '008-龙井问茶.jpg', w: 1600, h: 1000, sky: ['#6f9a5a', '#a8c488', '#e6efd0'], hills: ['#4a7040', '#355530', '#243b22'], sun: '#fbffd9' },
  ];

  const blobs = await Promise.all(
    shots.map(
      (s) =>
        new Promise((res) => {
          paint(s.w, s.h, s.sky, s.hills, s.sun).toBlob(
            (b) => res({ name: s.name, n: Number(s.name.slice(0, 3)), blob: b }),
            'image/jpeg',
            0.86,
          );
        }),
    ),
  );

  return new Promise((resolve) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const { name, n, blob } of blobs) {
        const file = new File([blob], name, { type: 'image/jpeg' });
        const rel = `浙江省/杭州市/${n <= 4 ? '西湖区/' : ''}${name}`;
        store.put(file, 'blob:' + rel);
      }
      tx.oncomplete = () => {
        db.close();
        resolve({ written: blobs.length });
      };
      tx.onerror = () => resolve({ error: 'tx error' });
      tx.onabort = () => resolve({ error: 'tx abort' });
    };
    open.onerror = () => resolve({ error: 'open error' });
  });
};

const browser = await chromium.launch({ executablePath: CHROME });

/* ---- PC：有照片的照片墙 + 3D 星系 ---- */
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pc.addInitScript(SEED_INDEX);
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(2500);
console.log('blob写入:', JSON.stringify(await pc.evaluate(PAINT_AND_STORE)));
// 重新开一次照片墙：组件卸载重挂，photoUrl 会重新走 IndexedDB 缓存
await pc.evaluate(() => window.__sandboxApp.closePhotoWall?.());
await pc.waitForTimeout(300);
await pc.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州 · 照片墙' }),
);
await pc.waitForTimeout(3000);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-wall.png') });

/* 切到 3D 照片空间 */
await pc.evaluate(() => {
  const chip = [...document.querySelectorAll('.wall-style-chip')].find((b) =>
    b.textContent.includes('3D'),
  );
  chip?.click();
});
await pc.waitForTimeout(4000);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-hall.png') });
await pc.keyboard.press('Escape');
await pc.waitForTimeout(600);

/* ---- 手机端：照片墙 ---- */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
await m.addInitScript(SEED_INDEX);
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForTimeout(2500);
await m.evaluate(PAINT_AND_STORE);
await m.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州 · 照片墙' }),
);
await m.waitForTimeout(3000);
await m.screenshot({ path: path.join(OUT, 'doc-m-wall.png') });

await browser.close();
console.log('照片墙配图完成: doc-pc-wall.png / doc-pc-hall.png / doc-m-wall.png');
