/**
 * 文档配图（README + 用户手册）：直接从当前版本截取，覆盖 docs/images/doc-*.jpg 与 docs/screenshot.jpg
 * 预置：足迹、收藏、游记、本地照片库（canvas 现画「风景照」写入 IndexedDB）
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const IMG = path.resolve('docs/images');
const ROOT = path.resolve('docs');


/* ---------- 预置本地数据（在所有脚本之前执行） ---------- */
const SEED = () => {
  const DAY = 86400000;
  const now = Date.now();
  const note = (id, title, body, placeKind, placeId, placeName, daysAgo, images = []) => {
    const t = now - daysAgo * DAY;
    return { id, title, body, placeKind, placeId, placeName, images, createdAt: t, updatedAt: t };
  };
  const notes = [
    note(
      'n1',
      '西湖两日：从苏堤走到北山街',
      '<p>清晨六点半的苏堤几乎没有人，湖面像一块没打磨完的镜子。<b>从南往北走</b>，一路都能看到对岸的保俶塔。</p>' +
        '<p>傍晚回到北山街，梧桐叶落在车顶，民国老房子一栋接一栋。断桥边人太多，往西走两百米就安静下来了。</p>' +
        '<blockquote>「水光潋滟晴方好，山色空蒙雨亦奇。」</blockquote>' +
        '<p>第二天去了灵隐，飞来峰的石刻要慢慢看，别赶。</p>',
      'district',
      '330106',
      '西湖区',
      6,
    ),
    note(
      'n2',
      '千岛湖 · 环湖骑行',
      '<p>环湖绿道从排岭半岛出发，一路都是水。骑到界首附近有一段连续上坡，风景值回票价。</p>' +
        '<p>午饭在渔村里吃的鱼头，<b>一定要点清汤</b>，别放辣。</p>',
      'district',
      '330127',
      '淳安县',
      18,
    ),
    note(
      'n3',
      '苏州老城的四个下午',
      '<p>平江路往北拐进钮家巷，游客一下子少了。网师园的夜花园要提前订。</p>' +
        '<p>面要吃头汤面，早上七点前去。</p>',
      'city',
      '320500',
      '苏州市',
      40,
    ),
  ];

  localStorage.setItem('ds.travelNotes.v1', JSON.stringify(notes));

  localStorage.setItem(
    'ds.cityStatus.v1',
    JSON.stringify({
      visited: ['330100', '320500', '310000', '320100'],
      visitedDistricts: ['330106', '330127', '320508', '320505', '330110', '310101', '320102'],
    }),
  );

  localStorage.setItem(
    'ds.visits.v1',
    JSON.stringify([
      { id: 'v1', kind: 'district', placeId: '330106', at: now - 6 * DAY },
      { id: 'v2', kind: 'district', placeId: '330127', at: now - 18 * DAY, endAt: now - 16 * DAY },
      { id: 'v3', kind: 'city', placeId: '320500', at: now - 40 * DAY },
      { id: 'v4', kind: 'district', placeId: '320508', at: now - 41 * DAY },
      { id: 'v5', kind: 'city', placeId: '310000', at: now - 96 * DAY },
      { id: 'v6', kind: 'district', placeId: '310101', at: now - 97 * DAY },
      { id: 'v7', kind: 'city', placeId: '320100', at: now - 150 * DAY },
    ]),
  );

  localStorage.setItem(
    'ds.favorites.v1',
    JSON.stringify({
      cities: ['320500'],
      districts: ['330127', '330106'],
      spots: [],
    }),
  );

  /* 本地照片库索引：城市级 12 张，区县级若干 */
  const mk = (n, name, shape, sub = '') => ({
    path: `浙江省/杭州市/${sub}${name}`,
    name,
    kind: 'image',
    shape,
    mtime: now - n * DAY,
  });
  const cityShots = [
    ['钱江夜色', 'portrait'],
    ['河坊街巷', 'portrait'],
    ['城市全景', 'other'],
    ['龙井问茶', 'landscape'],
    ['北山街梧桐', 'landscape'],
    ['断桥残雪', 'landscape'],
    ['宝石山日出', 'landscape'],
    ['运河货船', 'landscape'],
    ['南宋御街', 'portrait'],
    ['梅家坞茶山', 'landscape'],
    ['西溪芦苇', 'landscape'],
    ['武林门夜色', 'portrait'],
  ];
  const cityList = cityShots.map(([nm, shape], i) =>
    mk(i + 1, `${String(i + 1).padStart(3, '0')}-${nm}.jpg`, shape),
  );

  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({
      rootName: '本地照片',
      boundAt: new Date().toISOString(),
      persistent: false,
      total: cityList.length + 4,
      byCity: { '330100': cityList },
      byDistrict: {
        '330106': [
          mk(1, '001-苏堤春晓.jpg', 'landscape', '西湖区/'),
          mk(2, '002-雷峰夕照.jpg', 'landscape', '西湖区/'),
          mk(3, '003-灵隐禅意.jpg', 'landscape', '西湖区/'),
          mk(4, '004-曲院风荷.jpg', 'landscape', '西湖区/'),
        ],
      },
    }),
  );
};

/* ---------- 页面里画「风景照」并缓存进 IndexedDB ---------- */
const PAINT_AND_STORE = async (names) => {
  const DB = 'ds-photolib';
  const STORE = 'handles';

  const palettes = [
    [['#2b3a67', '#c96f4a', '#f2b879'], ['#2a2f45', '#1f2436', '#171b29'], '#ffe6b0'],
    [['#7fb2d9', '#cfe4f2', '#f6e7c8'], ['#5d7a5a', '#3f5a44', '#2c4232'], '#fff6d8'],
    [['#3d2f5f', '#a45a7a', '#e89a72'], ['#33284a', '#241d38', '#181327'], '#ffd9a0'],
    [['#4a6b52', '#8fae86', '#dfe8cf'], ['#33502f', '#223a24', '#16281a'], '#f0ffd9'],
    [['#101a30', '#1d2f52', '#3a5a8c'], ['#0e1526', '#0a1020', '#070b16'], '#cfe0ff'],
    [['#5a3a2e', '#a86b4a', '#e0b184'], ['#3d2820', '#2a1c16', '#1c130f'], '#ffe2b8'],
    [['#274060', '#5b82ab', '#c8d8e8'], ['#1c2c44', '#141f33', '#0d1524'], '#eaf4ff'],
    [['#6f9a5a', '#a8c488', '#e6efd0'], ['#4a7040', '#355530', '#243b22'], '#fbffd9'],
  ];

  function paint(w, h, [sky, hills, sun]) {
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
    g.globalAlpha = 0.45;
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
    g.fillRect(0, h * 0.9, w, h * 0.1);
    g.globalAlpha = 1;
    return c;
  }

  const blobs = await Promise.all(
    names.map(
      (item, i) =>
        new Promise((res) => {
          const isPortrait = /(夜色|街巷|御街)/.test(item.name);
          const isSquare = /全景/.test(item.name);
          const w = isPortrait ? 1000 : isSquare ? 1400 : 1600;
          const h = isPortrait ? 1600 : isSquare ? 1400 : 1000;
          paint(w, h, palettes[i % palettes.length]).toBlob(
            (b) => res({ name: item.name, dir: item.dir ?? '', blob: b }),
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
      for (const { name, dir, blob } of blobs) {
        const file = new File([blob], name, { type: 'image/jpeg' });
        store.put(file, 'blob:' + `浙江省/杭州市/${dir}${name}`);
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

const SHOTS = [
  { name: '001-钱江夜色.jpg', dir: '' },
  { name: '002-河坊街巷.jpg', dir: '' },
  { name: '003-城市全景.jpg', dir: '' },
  { name: '004-龙井问茶.jpg', dir: '' },
  { name: '005-北山街梧桐.jpg', dir: '' },
  { name: '006-断桥残雪.jpg', dir: '' },
  { name: '007-宝石山日出.jpg', dir: '' },
  { name: '008-运河货船.jpg', dir: '' },
  { name: '009-南宋御街.jpg', dir: '' },
  { name: '010-梅家坞茶山.jpg', dir: '' },
  { name: '011-西溪芦苇.jpg', dir: '' },
  { name: '012-武林门夜色.jpg', dir: '' },
  { name: '001-苏堤春晓.jpg', dir: '西湖区/' },
  { name: '002-雷峰夕照.jpg', dir: '西湖区/' },
  { name: '003-灵隐禅意.jpg', dir: '西湖区/' },
  { name: '004-曲院风荷.jpg', dir: '西湖区/' },
];

/* ---------- 地点封面图：写进游记图片库（背景图覆盖层共用） ---------- */
const SEED_BACKGROUNDS = async (keys) => {
  function paint(w, h, [sky, hills, sun]) {
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
    g.arc(w * 0.7, h * 0.28, Math.min(w, h) * 0.06, 0, Math.PI * 2);
    g.fill();
    const layers = [
      { color: hills[0], base: 0.6, amp: 0.09 },
      { color: hills[1], base: 0.73, amp: 0.07 },
      { color: hills[2], base: 0.86, amp: 0.04 },
    ];
    for (const L of layers) {
      g.fillStyle = L.color;
      g.beginPath();
      g.moveTo(0, h);
      let x = 0;
      let y = h * L.base;
      while (x <= w) {
        g.lineTo(x, y);
        x += w / 7;
        y = h * (L.base - Math.random() * L.amp);
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    }
    return c;
  }

  const palettes = [
    [['#33507a', '#7fa6c9', '#dbe7ef'], ['#2a3f4a', '#1d2d36', '#141f26'], '#fff4d6'],
    [['#3d6b74', '#8fbfb4', '#e2efe4'], ['#2c4a42', '#1e352f', '#152520'], '#fff6df'],
    [['#4a5f8a', '#9ab0cf', '#e8eef6'], ['#384b62', '#27364a', '#1a2532'], '#fff3d5'],
    [['#6b6a86', '#b7a8b8', '#f0e2d8'], ['#4c4658', '#38333f', '#26232b'], '#ffe8c2'],
  ];

  const blobs = await Promise.all(
    keys.map(
      (k, i) =>
        new Promise((res) => {
          paint(1600, 900, palettes[i % palettes.length]).toBlob(
            (b) => res({ key: k, id: `bg-${k.replace(/:/g, '-')}`, blob: b }),
            'image/jpeg',
            0.88,
          );
        }),
    ),
  );

  const map = {};
  for (const { key, id } of blobs) map[key] = id;
  localStorage.setItem('ds.backgrounds.v1', JSON.stringify(map));

  return await new Promise((resolve) => {
    const open = indexedDB.open('ds-travel-images', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      for (const { key, id, blob } of blobs) {
        store.put({ id, blob, name: key, type: 'image/jpeg', createdAt: Date.now() });
      }
      tx.oncomplete = () => {
        db.close();
        resolve(Object.keys(map).length);
      };
      tx.onerror = () => resolve(0);
    };
    open.onerror = () => resolve(0);
  });
};

const browser = await chromium.launch({ executablePath: CHROME });
const log = (...a) => console.log(...a);

/* 地点封面图：城市 / 区县面板与游记列表的封面都走这层覆盖图 */
const BG_KEYS = ['city:330100', 'district:330106', 'district:330127', 'city:320500'];

/* ================= 桌面端 ================= */
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
pc.on('pageerror', (e) => log('[pc pageerror]', String(e).slice(0, 140)));
await pc.addInitScript(SEED);
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

log('照片写入:', JSON.stringify(await pc.evaluate(PAINT_AND_STORE, SHOTS)));
log('封面写入:', await pc.evaluate(SEED_BACKGROUNDS, BG_KEYS));
/* 重载一次：相册索引与封面图都在启动时读入，必须走一遍冷启动 */
await pc.reload({ waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

/* 1. 总览 = README 头图 */
await pc.screenshot({ path: path.join(ROOT, 'screenshot.jpg') });
await pc.screenshot({ path: path.join(IMG, 'doc-pc-home.jpg') });
log('✓ 总览');

/* 2. 城市面板 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2600);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-city.jpg') });
log('✓ 城市面板');

/* 3. 区县详情 */
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await pc.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await pc.waitForTimeout(2200);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-district.jpg') });
log('✓ 区县详情');

/* 4. 照片墙：展厅 */
await pc.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州市 · 照片墙' }),
);
await pc.waitForTimeout(3400);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-wall.jpg') });
log('✓ 照片墙展厅');

/* 5. 照片墙：3D 照片空间 */
await pc.evaluate(() => {
  const chip = [...document.querySelectorAll('.wall-style-chip')].find((b) =>
    b.textContent.includes('3D'),
  );
  chip?.click();
});
await pc.waitForTimeout(4200);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-hall.jpg') });
log('✓ 3D 照片空间');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(900);

/* 6. 游记列表 */
await pc.evaluate(() => window.__sandboxApp.openTravelList());
await pc.waitForSelector('.note-card', { timeout: 8000 }).catch(() => null);
await pc.waitForTimeout(2600);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-travel.jpg') });
log('✓ 游记列表');

/* 7. 游记编辑器（带工具栏） */
await pc.evaluate(() => {
  const card = document.querySelector('.note-card');
  card?.click();
});
await pc.waitForTimeout(1400);
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
  btn?.click();
});
await pc.waitForTimeout(2200);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-travel-edit.jpg') });
log('✓ 游记编辑器');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(500);
await pc.keyboard.press('Escape');
await pc.waitForTimeout(800);

/* 8. 时间线 */
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.bottom-right .ghost-pill')].find((b) =>
    b.textContent.includes('时间线'),
  );
  btn?.click();
});
await pc.waitForTimeout(2000);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-timeline.jpg') });
log('✓ 时间线');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(700);

/* 9. 足迹收藏 */
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.bottom-right .ghost-pill')].find((b) =>
    b.textContent.includes('足迹'),
  );
  btn?.click();
});
await pc.waitForTimeout(2000);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-favorites.jpg') });
log('✓ 足迹收藏');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(700);

/* 10. 数据面板 */
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.top-right .data-pill')].find((b) =>
    b.textContent.includes('数据'),
  );
  btn?.click();
});
await pc.waitForTimeout(2000);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-data.jpg') });
log('✓ 数据面板');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(700);

/* 11. 搜索 */
await pc.click('.search-field input');
await pc.type('.search-field input', '西湖', { delay: 70 });
await pc.waitForTimeout(1500);
await pc.screenshot({ path: path.join(IMG, 'doc-pc-search.jpg') });
log('✓ 搜索');
await pc.keyboard.press('Escape');
await pc.waitForTimeout(400);

await pc.close();

/* ================= 手机端 ================= */
/* 用安卓 UA：应用内判断「手机套壳」看的是 navigator.userAgent，普通窄窗口模拟不到真实手机布局 */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
});
m.on('pageerror', (e) => log('[m pageerror]', String(e).slice(0, 140)));
await m.addInitScript(SEED);
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForTimeout(8000);
await m.evaluate(PAINT_AND_STORE, SHOTS);
await m.evaluate(SEED_BACKGROUNDS, BG_KEYS);
await m.reload({ waitUntil: 'networkidle' });
await m.waitForTimeout(8000);
await m.screenshot({ path: path.join(IMG, 'doc-m-home.jpg') });
log('✓ 手机总览');

await m.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await m.waitForTimeout(2600);
await m.screenshot({ path: path.join(IMG, 'doc-m-city.jpg') });
log('✓ 手机城市面板');

await m.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(2200);
await m.screenshot({ path: path.join(IMG, 'doc-m-district.jpg') });
log('✓ 手机区县详情');

await m.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330106', title: '西湖区 · 照片墙' }),
);
await m.waitForTimeout(3400);
await m.screenshot({ path: path.join(IMG, 'doc-m-wall.jpg') });
log('✓ 手机照片墙');

/* 关掉照片墙再开游记：两者都是浮层，不关会被压在下面 */
await m.click('.wall-close').catch(() => null);
await m.waitForTimeout(1200);
await m.evaluate(() => window.__sandboxApp.openTravelList());
await m.waitForSelector('.note-card', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(2400);
await m.screenshot({ path: path.join(IMG, 'doc-m-travel.jpg') });
log('✓ 手机游记列表');

await browser.close();
log('全部配图完成');
