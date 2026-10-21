/**
 * v1.2 诊断：上传落盘「省/市/区县」+ 批量删除二次确认 + 查看器删除 + 移动端管理栏
 * 运行：node scripts/diag-v12.mjs（需 dev server 127.0.0.1:1420）
 * 内存磁盘后端经 window.__diskOverride 注入：记录写入 / 删除路径，免真实文件系统。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { makePng } from './fixture-png.mjs';
import fs from 'node:fs';

const { chromium } = pw;
const OUT = 'regression-shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ``}`);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

/* 预置照片库 + 内存磁盘后端（淳安 3 张、杭州 1 张，路径与索引一致） */
const SEED = [
  ['浙江省/杭州市/淳安县/千岛湖-01.jpg', 320, 200],
  ['浙江省/杭州市/淳安县/千岛湖-02.jpg', 200, 320],
  ['浙江省/杭州市/淳安县/村落-03.jpg', 260, 260],
  ['杭州市/西湖-04.jpg', 320, 200],
];

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));

await page.addInitScript((seed) => {
  const files = new Map();
  const mkFile = async (path, w, h) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1b5e9c');
    g.addColorStop(1, '#7ec8f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], path.split('/').pop(), { type: 'image/jpeg', lastModified: 1729300800000 });
  };
  void (async () => {
    for (const [path, w, h] of seed) files.set(path, await mkFile(path, w, h));
  })();

  window.__diskWritten = [];
  window.__diskDeleted = [];
  window.__diskOverride = {
    kind: 'fsa',
    hasRoot: async () => true,
    rootLabel: async () => '测试照片根目录',
    ensureRoot: async () => true,
    repickRoot: async () => true,
    writeFiles: async (relDir, list) => {
      const out = [];
      for (const f of list) {
        const p = `${relDir}/${f.name}`;
        files.set(p, f);
        out.push(p);
        window.__diskWritten.push(p);
      }
      return out;
    },
    deleteFiles: async (paths) => {
      for (const p of paths) {
        files.delete(p);
        window.__diskDeleted.push(p);
      }
      return paths.length;
    },
    scan: async () =>
      [...files.entries()].map(([path, f]) => ({
        path,
        name: path.split('/').pop(),
        file: f,
        mtime: f.lastModified || 0,
      })),
    directUrl: () => null,
  };

  const idx = {
    rootName: '测试照片根目录',
    boundAt: new Date().toISOString(),
    persistent: true,
    total: 4,
    byDistrict: {
      '330127': seed.slice(0, 3).map(([path]) => ({
        path,
        name: path.split('/').pop(),
        kind: 'image',
        shape: 'landscape',
        mtime: 1729300800000,
      })),
    },
    byCity: {
      '330100': [
        { path: seed[3][0], name: '西湖-04.jpg', kind: 'image', shape: 'landscape', mtime: 1729300800000 },
      ],
    },
  };
  localStorage.setItem('ds.photoLib.index.v1', JSON.stringify(idx));
}, SEED);

await page.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);

await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);

/* ---------- 1. 上传落盘到 省/市/区县 ---------- */
await page.click('.photo-wall-trigger');
await page.waitForSelector('.wall-backdrop', { timeout: 5000 });
await page.waitForTimeout(900);
const baseTiles = await page.locator('.wall-tile').count();
check('1a 淳安照片墙初始就绪', baseTiles >= 3, `tiles=${baseTiles}`);

await page.setInputFiles('.wall-head-actions input[type=file]', [
  { name: '上传-甲.jpg', mimeType: 'image/jpeg', buffer: makePng(300, 200, [30, 90, 200]) },
  { name: '上传-乙.png', mimeType: 'image/png', buffer: makePng(200, 300, [200, 90, 30]) },
]);
await page.waitForFunction(
  (n) => document.querySelectorAll('.wall-tile').length >= n + 2,
  baseTiles,
  { timeout: 30000 },
);
const written = await page.evaluate(() => window.__diskWritten);
check(
  '1b 上传写入 浙江省/杭州市/淳安县/ 文件夹',
  written.length === 2 &&
    written[0] === '浙江省/杭州市/淳安县/上传-甲.jpg' &&
    written[1] === '浙江省/杭州市/淳安县/上传-乙.png',
  JSON.stringify(written),
);
const tilesAfterUpload = await page.locator('.wall-tile').count();
check('1c 上传后即时上墙（本地照片身份）', tilesAfterUpload === baseTiles + 2, `tiles=${tilesAfterUpload}`);
const liveBadges = await page.locator('.wall-media-badge--live').count();
check('1d 新上传标记 LIVE', liveBadges >= 2, `live=${liveBadges}`);
await page.screenshot({ path: `${OUT}/diag-v12-wall-upload.png` });

/* ---------- 2. 批量删除：二次确认 ---------- */
await page.click('.wall-manage-toggle');
await page.waitForSelector('.wall-manage', { timeout: 3000 });
check('2a 管理模式打开', true);

// 新上传的两张在末尾（增量合并追加）
await page.locator('.wall-tile').nth(baseTiles).click();
await page.locator('.wall-tile').nth(baseTiles + 1).click();
const selText = await page.locator('.wall-manage-count b').textContent();
check('2b 勾选 2 张', selText === '2', `已选 ${selText}`);

// 第一下：进入待确认态（按钮变红、文案警示）
await page.locator('.wall-manage-actions .ghost-btn.is-danger, .wall-manage-actions .ghost-btn').nth(1).click();
const delBtn = page.locator('.wall-manage-actions .ghost-btn', { hasText: '删除' });
const armedText = await delBtn.textContent();
const armedClass = await delBtn.getAttribute('class');
check(
  '2c 第一下仅进入确认态（未删除）',
  /再点一次确认删除 2 个文件/.test(armedText ?? '') && (armedClass ?? '').includes('is-danger'),
  `文案="${armedText}" class="${armedClass}"`,
);
const stillThere = await page.locator('.wall-tile').count();
check('2d 确认态下照片仍在', stillThere === baseTiles + 2, `tiles=${stillThere}`);

// 第二下：真删（磁盘文件移除）
await delBtn.click();
await page.waitForFunction(
  (n) => document.querySelectorAll('.wall-tile').length <= n,
  baseTiles,
  { timeout: 30000 },
);
const deleted = await page.evaluate(() => window.__diskDeleted);
check(
  '2e 第二下确认后删除磁盘文件',
  deleted.length === 2 && deleted.every((p) => p.startsWith('浙江省/杭州市/淳安县/')),
  JSON.stringify(deleted),
);
const tilesAfterDelete = await page.locator('.wall-tile').count();
check('2f 删除后照片墙回落', tilesAfterDelete === baseTiles, `tiles=${tilesAfterDelete}`);
const liveAfter = await page.locator('.wall-media-badge--live').count();
check('2g 删除后无残留 LIVE', liveAfter === 0, `live=${liveAfter}`);
await page.screenshot({ path: `${OUT}/diag-v12-wall-manage.png` });

/* ---------- 3. 城市上传：省/市 两级 ---------- */
await page.click('.wall-manage-toggle'); // 退出管理
await page.waitForTimeout(300);
await page.click('.wall-close');
await page.waitForTimeout(400);

await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2200);
await page.click('.city-panel .photo-wall-trigger');
await page.waitForSelector('.wall-backdrop', { timeout: 5000 });
await page.waitForTimeout(800);
const cityBase = await page.locator('.wall-tile').count();
await page.setInputFiles('.wall-head-actions input[type=file]', [
  { name: '上传-丙.jpg', mimeType: 'image/jpeg', buffer: makePng(320, 240, [90, 30, 200]) },
]);
await page.waitForFunction(
  (n) => document.querySelectorAll('.wall-tile').length >= n + 1,
  cityBase,
  { timeout: 30000 },
);
const cityWritten = await page.evaluate(() => window.__diskWritten.slice(-1));
check('3a 城市上传写入 浙江省/杭州市/', cityWritten[0] === '浙江省/杭州市/上传-丙.jpg', JSON.stringify(cityWritten));

/* ---------- 4. 查看器删除：两段式 ---------- */
await page.locator('.wall-tile').first().click();
await page.waitForSelector('.pv-backdrop', { timeout: 5000 });
await page.waitForTimeout(400);
await page.click('.pv-del');
const pvText = await page.locator('.pv-del').textContent();
check('4a 查看器第一下进入确认态', (pvText ?? '').includes('确认删除'), `文案="${pvText}"`);
const pvStill = await page.locator('.pv-backdrop').count();
check('4b 确认态下查看器不关闭', pvStill === 1);
await page.click('.pv-del');
await page.waitForFunction(() => !document.querySelector('.pv-backdrop'), { timeout: 15000 });
const pvDeleted = await page.evaluate(() => window.__diskDeleted.slice(-1));
check('4c 第二下确认后删除并关闭查看器', pvDeleted.length === 1, JSON.stringify(pvDeleted));
await page.click('.wall-close');
await page.waitForTimeout(300);

/* ---------- 5. 移动端：管理栏不横向溢出 ---------- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.addInitScript((seed) => {
  const files = new Map();
  const mkFile = async (path, w, h) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1b5e9c';
    ctx.fillRect(0, 0, w, h);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], path.split('/').pop(), { type: 'image/jpeg', lastModified: 1729300800000 });
  };
  void (async () => {
    for (const [path, w, h] of seed) files.set(path, await mkFile(path, w, h));
  })();
  window.__diskWritten = [];
  window.__diskDeleted = [];
  window.__diskOverride = {
    kind: 'fsa',
    hasRoot: async () => true,
    rootLabel: async () => '测试照片根目录',
    ensureRoot: async () => true,
    repickRoot: async () => true,
    writeFiles: async (relDir, list) => {
      const out = [];
      for (const f of list) {
        const p = `${relDir}/${f.name}`;
        files.set(p, f);
        out.push(p);
        window.__diskWritten.push(p);
      }
      return out;
    },
    deleteFiles: async (paths) => {
      for (const p of paths) {
        files.delete(p);
        window.__diskDeleted.push(p);
      }
      return paths.length;
    },
    scan: async () =>
      [...files.entries()].map(([path, f]) => ({ path, name: path.split('/').pop(), file: f, mtime: 0 })),
    directUrl: () => null,
  };
  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({
      rootName: '测试照片根目录',
      boundAt: new Date().toISOString(),
      persistent: true,
      total: 3,
      byDistrict: {
        '330127': seed.slice(0, 3).map(([path]) => ({ path, name: path.split('/').pop(), kind: 'image', shape: 'landscape', mtime: 1729300800000 })),
      },
      byCity: {},
    }),
  );
}, SEED);

await mobile.goto('http://127.0.0.1:1420/', { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForSelector('.hud-top', { timeout: 15000 });
await mobile.waitForTimeout(2600);
await mobile.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await mobile.waitForTimeout(1600);
await mobile.click('.photo-wall-trigger');
await mobile.waitForSelector('.wall-backdrop', { timeout: 5000 });
await mobile.waitForTimeout(700);
await mobile.click('.wall-manage-toggle');
await mobile.waitForSelector('.wall-manage', { timeout: 3000 });
const overflow = await mobile.evaluate(() => {
  const bar = document.querySelector('.wall-manage');
  const r = bar.getBoundingClientRect();
  return { scrollW: bar.scrollWidth, clientW: bar.clientWidth, right: Math.round(r.right), vw: window.innerWidth };
});
check('5a 移动端管理栏不横向溢出', overflow.scrollW <= overflow.clientW + 1 && overflow.right <= overflow.vw, JSON.stringify(overflow));
const wallFs = await mobile.evaluate(() => {
  const m = document.querySelector('.wall-modal');
  const r = m.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(m).borderRadius };
});
check('5b 移动端照片墙仍全屏', wallFs.w === 390 && wallFs.h === 844 && wallFs.radius === '0px', JSON.stringify(wallFs));
await mobile.screenshot({ path: `${OUT}/diag-v12-mobile-manage.png` });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
