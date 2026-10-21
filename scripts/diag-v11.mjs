import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { makePng } from './fixture-png.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { chromium } = pw;
const OUT = 'regression-shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

/* ============ 桌面视口 ============ */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// 预置照片库索引（淳安县 3 张 + 杭州 1 张）
await page.addInitScript(() => {
  const idx = {
    rootName: '测试照片',
    boundAt: new Date().toISOString(),
    persistent: false,
    total: 4,
    byDistrict: {
      '330127': [
        { path: '浙江省/杭州市/淳安县/千岛湖-01.jpg', name: '千岛湖-01.jpg', kind: 'image', shape: 'landscape', mtime: 1729300800000 },
        { path: '浙江省/杭州市/淳安县/千岛湖-02.jpg', name: '千岛湖-02.jpg', kind: 'image', shape: 'portrait', mtime: 1729300900000 },
        { path: '浙江省/杭州市/淳安县/村落-03.jpg', name: '村落-03.jpg', kind: 'image', shape: 'other', mtime: 1729301000000 },
      ],
    },
    byCity: {
      '330100': [{ path: '杭州市/西湖-04.jpg', name: '西湖-04.jpg', kind: 'image', shape: 'landscape', mtime: 1729301100000 }],
    },
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(idx));
});

await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);

// 往照片库 IndexedDB 里塞图片字节（模拟扫描时写入的缓存）
await page.evaluate(async () => {
  const mk = (w, h, c) =>
    new Promise((resolve) => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, c[0]);
      g.addColorStop(1, c[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      cv.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
    });
  const blobs = {
    'blob:浙江省/杭州市/淳安县/千岛湖-01.jpg': await mk(320, 200, ['#1b5e9c', '#7ec8f2']),
    'blob:浙江省/杭州市/淳安县/千岛湖-02.jpg': await mk(200, 320, ['#9c1b5e', '#f27ec8']),
    'blob:浙江省/杭州市/淳安县/村落-03.jpg': await mk(260, 260, ['#5e9c1b', '#c8f27e']),
    'blob:杭州市/西湖-04.jpg': await mk(320, 200, ['#5e1b9c', '#c87ef2']),
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

/* ---------- 1. 区县换图按钮不被裁 ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);
const pickerGeo = await page.evaluate(() => {
  const cover = document.querySelector('.drawer-cover');
  const btn = cover.querySelector('.bg-picker-btn');
  const b = btn.getBoundingClientRect();
  const picker = cover.querySelector('.bg-picker');
  const corners = [
    [b.x + 2, b.y + 2],
    [b.right - 2, b.y + 2],
    [b.x + 2, b.bottom - 2],
    [b.right - 2, b.bottom - 2],
  ].every(([x, y]) => picker.contains(document.elementFromPoint(x, y)));
  return { corners, w: Math.round(b.width) };
});
check('1a 区县换图按钮四角可点（不再被抽屉裁切）', pickerGeo.corners === true, `按钮宽 ${pickerGeo.w}px`);

/* ---------- 2. 游记从照片库多选 ---------- */
await page.click('.drawer-actions .ghost-btn'); // 写游记
await page.waitForSelector('.note-editor', { timeout: 5000 });
await page.waitForTimeout(300);
await page.click('.note-images-acts .ghost-btn'); // 从照片库挑选
await page.waitForSelector('.np-backdrop', { timeout: 5000 });
const npCells = await page.locator('.np-cell').count();
check('2a 照片库挑选器打开且列出淳安县 3 张', npCells === 3, `cells=${npCells}`);
await page.waitForSelector('.np-cell-img img', { timeout: 6000 });
const thumbs = await page.locator('.np-cell-img img').count();
const thumbOk = await page.evaluate(() =>
  [...document.querySelectorAll('.np-cell-img img')].every((i) => i.naturalWidth > 0),
);
check('2b 缩略图全部解析出字节', thumbs === 3 && thumbOk, `${thumbs} 张`);

await page.locator('.np-cell').nth(0).click();
await page.locator('.np-cell').nth(2).click();
const picked = await page.locator('.np-count b').textContent();
check('2c 多选勾选 2 张', picked === '2', `已选 ${picked}`);
await page.screenshot({ path: `${OUT}/diag-v11-nppicker.png` });
await page.click('.np-foot .primary-btn'); // 添加
// 本环境 IndexedDB 单次写入约 2s（WebGL 占主线程），给足超时
await page.waitForSelector('.note-image-grid li', { timeout: 20000 });
await page.waitForFunction(
  () => [...document.querySelectorAll('.note-image-grid img')].length >= 2,
  { timeout: 20000 },
);
const noteImgs = await page.locator('.note-image-grid li').count();
const noteImgOk = await page.evaluate(() =>
  [...document.querySelectorAll('.note-image-grid img')].every((i) => i.src.startsWith('blob:') && i.naturalWidth > 0),
);
check('2d 批量导入 2 张进游记编辑器', noteImgs === 2 && noteImgOk, `${noteImgs} 张`);

// 验证字节确实落进了游记图片库
const imgCount = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('ds-travel-images', 1);
      req.onsuccess = () => {
        const r = req.result.transaction('images', 'readonly').objectStore('images').count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    }),
);
check('2e 游记图片字节入库 IndexedDB', imgCount >= 2, `count=${imgCount}`);

await page.click('.note-editor-head .icon-btn'); // 关闭游记面板

/* ---------- 3. 照片墙批量上传 ---------- */
await page.click('.photo-wall-trigger');
await page.waitForSelector('.wall-backdrop', { timeout: 5000 });
await page.waitForTimeout(600);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wallup-'));
const files = [
  { name: '上传-甲.jpg', mimeType: 'image/jpeg', buffer: makePng(300, 200, [30, 90, 200]) },
  { name: '上传-乙.png', mimeType: 'image/png', buffer: makePng(200, 300, [200, 90, 30]) },
];
await page.setInputFiles('.wall-head-actions input[type=file]', files);
await page.waitForTimeout(900);
const badges = await page.locator('.wall-media-badge--upload').count();
const tiles = await page.locator('.wall-tile').count();
// 淳安县墙 = 2 个上传 + 3 张预置本地照片
check('3a 批量上传 2 个媒体并上墙', badges === 2 && tiles === 5, `badges=${badges} tiles=${tiles}`);
const upCount = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('ds-wall-uploads', 1);
      req.onsuccess = () => {
        const r = req.result.transaction('media', 'readonly').objectStore('media').count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-1);
    }),
);
check('3b 上传字节入库 ds-wall-uploads', upCount === 2, `count=${upCount}`);
await page.screenshot({ path: `${OUT}/diag-v11-wall-upload.png` });

// 刷新后仍在上传列表里（restore）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1200);
await page.click('.photo-wall-trigger');
await page.waitForSelector('.wall-backdrop', { timeout: 5000 });
await page.waitForFunction(
  () => document.querySelectorAll('.wall-media-badge--upload').length >= 2,
  { timeout: 15000 },
);
const restored = await page.locator('.wall-media-badge--upload').count();
const tilesAfter = await page.locator('.wall-tile').count();
check('3c 刷新后上传项仍在照片墙（restore）', restored === 2, `badges=${restored} tiles=${tilesAfter}`);

// 删除一个上传
await page.locator('.wall-tile-del').first().click();
await page.waitForTimeout(700);
const afterDel = await page.locator('.wall-media-badge--upload').count();
check('3d 网格内可删除上传项', afterDel === 1, `剩 ${afterDel}`);
await page.click('.wall-close');
await page.waitForTimeout(300);

/* ---------- 4. 移动端弹框全屏 ---------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.addInitScript(() => {
  const idx = {
    rootName: '测试照片',
    boundAt: new Date().toISOString(),
    persistent: false,
    total: 0,
    byDistrict: {},
    byCity: {},
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(idx));
});
await mobile.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForSelector('.hud-top', { timeout: 15000 });
await mobile.waitForTimeout(2600);

const fullscreenOf = async (sel) =>
  mobile.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), radius: cs.borderRadius, top: Math.round(r.top) };
  }, sel);

// 游记面板
await mobile.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await mobile.waitForTimeout(1400);
await mobile.click('.city-act--note');
await mobile.waitForSelector('.travel-panel', { timeout: 5000 });
await mobile.waitForTimeout(300);
let fs1 = await fullscreenOf('.travel-panel');
check('4a 游记面板全屏', fs1 && fs1.w === 390 && fs1.h === 844 && fs1.radius === '0px', JSON.stringify(fs1));

// 照片库挑选器也全屏
await mobile.click('.note-images-acts .ghost-btn');
await mobile.waitForSelector('.np-panel', { timeout: 5000 });
let fs2 = await fullscreenOf('.np-panel');
check('4b 照片库挑选器全屏', fs2 && fs2.w === 390 && fs2.h === 844 && fs2.radius === '0px', JSON.stringify(fs2));
await mobile.click('.np-head .icon-btn');
await mobile.click('.note-editor-head .icon-btn');
await mobile.waitForTimeout(300);

// 设置面板（照片库）
await mobile.click('.data-pill--photo');
await mobile.waitForSelector('.photo-lib', { timeout: 5000 });
let fs3 = await fullscreenOf('.photo-lib');
check('4c 设置（照片库）面板全屏', fs3 && fs3.w === 390 && fs3.h === 844 && fs3.radius === '0px', JSON.stringify(fs3));
await mobile.screenshot({ path: `${OUT}/diag-v11-mobile-settings.png` });
await mobile.click('.photo-lib .data-head .icon-btn');
await mobile.waitForTimeout(300);

// 数据面板
await mobile.click('[title*="编辑本地内容"]');
await mobile.waitForSelector('.data-panel', { timeout: 5000 });
let fs4 = await fullscreenOf('.data-panel');
check('4d 数据面板全屏', fs4 && fs4.w === 390 && fs4.h === 844 && fs4.radius === '0px', JSON.stringify(fs4));
await mobile.click('.data-head .icon-btn');
await mobile.waitForTimeout(300);

// 照片墙
await mobile.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await mobile.waitForTimeout(1200);
await mobile.click('.photo-wall-trigger');
await mobile.waitForSelector('.wall-modal', { timeout: 5000 });
let fs5 = await fullscreenOf('.wall-modal');
check('4e 照片墙全屏', fs5 && fs5.w === 390 && fs5.h === 844 && fs5.radius === '0px', JSON.stringify(fs5));
await mobile.screenshot({ path: `${OUT}/diag-v11-mobile-wall.png` });
await mobile.click('.wall-close');
await mobile.waitForTimeout(300);

// 景点卡片（leaf card）
await mobile.click('.spot-row');
await mobile.waitForSelector('.leaf-card', { timeout: 5000 });
let fs6 = await fullscreenOf('.leaf-card');
check('4f 景点卡片全屏', fs6 && fs6.w === 390 && fs6.h === 844 && fs6.radius === '0px', JSON.stringify(fs6));
await mobile.screenshot({ path: `${OUT}/diag-v11-mobile-leaf.png` });

fs.rmSync(tmp, { recursive: true, force: true });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length > 0) process.exit(1);
