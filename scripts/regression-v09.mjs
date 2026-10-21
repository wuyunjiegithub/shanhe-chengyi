// v0.9 回归：①标记平衡 ②照片墙排序 ③自定义背景图 ④3D 照片空间 ⑤移动端
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, pixel, lum } from './png.mjs';
import { makePng } from './fixture-png.mjs';

const URL = process.env.REG_URL || 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

/* ---------------- 桌面验证 ---------------- */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console:' + m.text());
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1200);

/* ---- ① 标记平衡：红旗与爱心在屏幕上的高度应约为 42 : 28 ---- */
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForSelector('.city-cover img', { timeout: 10000 }).catch(() => null);
await page.waitForTimeout(1200);
// 标记「去过」+「收藏」同一个城市，两种标记会同时出现
await page.evaluate(() => {
  const v = [...document.querySelectorAll('.city-act')].find((b) => b.textContent.includes('去过'));
  v && v.click();
  const f = [...document.querySelectorAll('.city-act')].find((b) => b.textContent.includes('收藏'));
  f && f.click();
});
await page.waitForTimeout(900);
const markerSizes = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const out = [];
  for (const g of [S.cityMarkerGroup]) {
    for (const m of g.children) {
      out.push({
        kind: m.userData.kind,
        screenH: +(m.scale.x * (m.userData.intrinsicH || 1)).toFixed(3),
      });
    }
  }
  return out;
});
const visited = markerSizes.find((m) => m.kind === 'visited');
const favorite = markerSizes.find((m) => m.kind === 'favorite');
const ratio = visited && favorite ? visited.screenH / favorite.screenH : 0;
rec(
  '① 标记平衡(旗:心≈1.5)',
  Boolean(visited && favorite) && Math.abs(ratio - 42 / 28) < 0.06,
  `旗=${visited?.screenH} 心=${favorite?.screenH} 比值=${ratio.toFixed(3)}(期望1.50)`,
);

/* ---- ③ 自定义背景图：城市封面有换图入口，上传后覆盖生效 ---- */
const bgBefore = await page.evaluate(() => ({
  pickers: document.querySelectorAll('.city-cover .bg-picker').length,
  btn: !!document.querySelector('.city-cover .bg-picker-btn'),
}));
rec('③ 城市封面有换图入口', bgBefore.pickers === 1 && bgBefore.btn, `入口数=${bgBefore.pickers}`);

const pngPath = path.join(OUT, 'bg-fixture.png');
fs.writeFileSync(pngPath, makePng(240, 160, [20, 180, 120]));
await page.setInputFiles('.city-cover input[type=file]', pngPath);
await page.waitForTimeout(2200);
const bgAfter = await page.evaluate(() => {
  const img = document.querySelector('.city-cover img');
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem('ds.backgrounds.v1') || '{}');
  } catch {}
  return {
    src: img ? img.src.slice(0, 12) : null,
    keys: Object.keys(map),
    hasReset: !!document.querySelector('.city-cover .bg-picker-btn--reset'),
  };
});
rec(
  '③ 上传后背景被覆盖',
  bgAfter.src === 'blob:http://' || bgAfter.src === 'blob:https' || (bgAfter.src || '').startsWith('blob'),
  `img.src=${bgAfter.src} 覆盖键=${JSON.stringify(bgAfter.keys)} 恢复钮=${bgAfter.hasReset}`,
);

// 刷新后仍然生效（字节在 IndexedDB 里）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1500);
const bgPersist = await page.evaluate(() => {
  const img = document.querySelector('.city-cover img');
  return { src: img ? img.src.slice(0, 5) : null };
});
rec('③ 刷新后自定义背景仍在', bgPersist.src === 'blob:', `img.src=${bgPersist.src}`);

/* ---- ②/④ 需要照片：注入索引 + IndexedDB 字节缓存 ---- */
await page.evaluate(async () => {
  const mkBlob = async (w, h, color) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.fillRect(10, 10, w - 20, h - 20);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  };
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open('ds-photolib', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  // 文件名顺序与 mtime 顺序刻意错开：
  //   名称升序 a_001 < b_003 < c_002
  //   时间新旧 a_001(2022) > c_002(2021) > b_003(2020)
  // 注入顺序 b_003, a_001, c_002（默认序）
  const plan = [
    { name: 'b_003.jpg', color: [200, 40, 60], mtime: Date.UTC(2020, 2, 1) },
    { name: 'a_001.jpg', color: [40, 160, 220], mtime: Date.UTC(2022, 2, 1) },
    { name: 'c_002.jpg', color: [240, 200, 40], mtime: Date.UTC(2021, 2, 1) },
  ];
  const entries = [];
  for (const item of plan) {
    const p = `上海市/黄浦区/${item.name}`;
    const blob = await mkBlob(320, 200, item.color);
    await new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(blob, 'blob:' + p);
      tx.oncomplete = () => res();
    });
    entries.push({
      path: p,
      name: item.name,
      kind: 'image',
      shape: 'landscape',
      mtime: item.mtime,
    });
  }
  db.close();
  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({
      rootName: 'photos',
      boundAt: new Date().toISOString(),
      persistent: false,
      total: entries.length,
      byDistrict: { '310104': entries },
      byCity: {},
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForTimeout(1800);

const wallInfo = await page.evaluate(() => ({
  modal: !!document.querySelector('.wall-modal'),
  tiles: document.querySelectorAll('.wall-tile').length,
  imgs: [...document.querySelectorAll('.wall-tile img')].map((i) => i.src.slice(0, 5)),
  sorts: [...document.querySelectorAll('.wall-sort-chip')].map((b) => b.textContent),
}));
rec(
  '② 照片墙有排序条且照片可见',
  wallInfo.modal && wallInfo.tiles === 3 && wallInfo.imgs.every((s) => s === 'blob:') && wallInfo.sorts.length === 3,
  `照片=${wallInfo.tiles} 源=${JSON.stringify(wallInfo.imgs)} 排序=${JSON.stringify(wallInfo.sorts)}`,
);

/** 读取当前网格里的展签顺序 */
const order = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.wall-tile .wall-tile-plaque b')].map((b) => b.textContent.trim()),
  );
const defOrder = await order();
await page.evaluate(() => {
  [...document.querySelectorAll('.wall-sort-chip')].find((b) => b.textContent.includes('名称'))?.click();
});
await page.waitForTimeout(600);
const nameOrder = await order();
rec(
  '② 按名称排序(A→Z)',
  JSON.stringify(nameOrder) === JSON.stringify(['a_001', 'b_003', 'c_002']),
  `默认=${JSON.stringify(defOrder)} 名称升序=${JSON.stringify(nameOrder)}`,
);

await page.evaluate(() => {
  [...document.querySelectorAll('.wall-sort-chip')].find((b) => b.textContent.includes('时间'))?.click();
});
await page.waitForTimeout(600);
const timeOrder = await order();
rec(
  '② 按时间排序(新→旧)',
  JSON.stringify(timeOrder) === JSON.stringify(['a_001', 'c_002', 'b_003']),
  `时间降序=${JSON.stringify(timeOrder)}（mtime a=2022 > c=2021 > b=2020）`,
);

await page.evaluate(() => {
  [...document.querySelectorAll('.wall-sort-chip')].find((b) => b.textContent.includes('时间'))?.click();
});
await page.waitForTimeout(600);
const timeAsc = await order();
rec(
  '② 时间可翻转(旧→新)',
  JSON.stringify(timeAsc) === JSON.stringify(['b_003', 'c_002', 'a_001']),
  `时间升序=${JSON.stringify(timeAsc)}`,
);

/* ---- ④ 3D 照片空间：canvas 有尺寸 + 画面里真的有照片 ---- */
await page.evaluate(() => {
  [...document.querySelectorAll('.wall-style-chip')].find((b) => b.textContent.includes('3D'))?.click();
});
await page.waitForTimeout(3200);
const hall = await page.evaluate(() => {
  const el = document.querySelector('.hall3d canvas');
  return { has: !!el, w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
});
rec('④ 3D 照片空间有画布', hall.has && hall.w > 200 && hall.h > 150, `canvas=${hall.w}x${hall.h}`);

const shot = await page.locator('.hall3d').screenshot({ path: path.join(OUT, 'v09-hall3d.png') });
const img = decodePng(shot);
let bright = 0;
let total = 0;
for (let y = 0; y < img.height; y += 3) {
  for (let x = 0; x < img.width; x += 3) {
    total += 1;
    if (lum(pixel(img, x, y)) > 60) bright += 1;
  }
}
const brightRatio = bright / Math.max(total, 1);
rec(
  '④ 3D 空间里照片真的画出来了',
  brightRatio > 0.02,
  `亮像素占比=${(brightRatio * 100).toFixed(2)}%（背景 #05070d，>2% 说明照片已上墙）`,
);

const hallCount = await page.evaluate(() => {
  const S = window.__hall3d;
  return S ? S.count : null;
});
rec('④ 3D 空间纳入全部照片', hallCount === null || hallCount === 3, `空间内照片数=${hallCount ?? '未暴露(跳过)'}`);
await page.screenshot({ path: path.join(OUT, 'v09-wall-3d.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

/* ---------------- ⑤ 移动端 ---------------- */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 15000 });
await m.waitForTimeout(1500);

const mobileBase = await m.evaluate(() => {
  const top = document.querySelector('.hud-top');
  const idx = document.querySelector('.left-index');
  return {
    vw: window.innerWidth,
    topRect: top ? top.getBoundingClientRect().width : 0,
    indexHidden: !idx || getComputedStyle(idx).display === 'none',
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
rec(
  '⑤ 移动端无横向溢出',
  mobileBase.overflowX <= 1 && mobileBase.indexHidden,
  `视口=${mobileBase.vw} 横向溢出=${mobileBase.overflowX}px 左侧索引隐藏=${mobileBase.indexHidden}`,
);

await m.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(1200);
const drawerM = await m.evaluate(() => {
  const d = document.querySelector('.drawer');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const btn = d.querySelector('.panel-fs-btn');
  return {
    top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width),
    vh: window.innerHeight, vw: window.innerWidth, radius: cs.borderTopLeftRadius,
    hasFsBtn: Boolean(btn) && getComputedStyle(btn).display !== 'none',
  };
});
rec(
  '⑤ 区县抽屉移动端默认半屏（露出上半地图）',
  Boolean(drawerM) && drawerM.w > drawerM.vw * 0.9 && drawerM.bottom >= drawerM.vh - 2 &&
    drawerM.top >= drawerM.vh * 0.4 && drawerM.top <= drawerM.vh * 0.56,
  `抽屉=${drawerM ? `${drawerM.w}x(${drawerM.top}→${drawerM.bottom}) 圆角=${drawerM.radius}` : 'null'} 视口=${drawerM?.vw}x${drawerM?.vh}`,
);
rec(
  '⑤ 抽屉有全屏切换钮',
  Boolean(drawerM) && drawerM.hasFsBtn,
  `全屏钮可见=${drawerM?.hasFsBtn}`,
);

/* 点「全屏」→ 应铺满；再点一次 → 回到半屏 */
await m.click('.drawer .panel-fs-btn').catch(() => null);
await m.waitForTimeout(800);
const drawerFull = await m.evaluate(() => {
  const d = document.querySelector('.drawer');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, radius: getComputedStyle(d).borderTopLeftRadius };
});
rec(
  '⑤ 点全屏钮后铺满',
  Boolean(drawerFull) && drawerFull.top <= 1 && drawerFull.bottom >= drawerFull.vh - 2 && drawerFull.radius === '0px',
  `全屏后=${drawerFull ? `${drawerFull.top}→${drawerFull.bottom}` : 'null'} 圆角=${drawerFull?.radius} 视口高=${drawerFull?.vh}`,
);

await m.click('.drawer .panel-fs-btn').catch(() => null);
await m.waitForTimeout(800);
const drawerHalf = await m.evaluate(() => {
  const d = document.querySelector('.drawer');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { top: Math.round(r.top), vh: window.innerHeight };
});
rec(
  '⑤ 退出全屏回到半屏',
  Boolean(drawerHalf) && drawerHalf.top >= drawerHalf.vh * 0.4 && drawerHalf.top <= drawerHalf.vh * 0.56,
  `退出后顶=${drawerHalf?.top} 视口高=${drawerHalf?.vh}`,
);

await m.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await m.waitForTimeout(1800);
const panel = await m.evaluate(() => {
  const p = document.querySelector('.city-panel');
  const bar = document.querySelector('.hud-bottom');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const br = bar ? bar.getBoundingClientRect() : null;
  const fs = p.querySelector('.panel-fs-btn');
  return {
    w: Math.round(r.width),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    vw: window.innerWidth,
    vh: window.innerHeight,
    hasFsBtn: Boolean(fs) && getComputedStyle(fs).display !== 'none',
    barTop: br ? Math.round(br.top) : null,
    barH: br ? Math.round(br.height) : null,
    barRows: bar ? bar.querySelector('.bottom-right').getBoundingClientRect().height : null,
  };
});
rec(
  '⑤ 城市面板移动端默认半屏（露出上半地图）',
  Boolean(panel) && panel.w > panel.vw * 0.9 && panel.bottom >= panel.vh - 2 &&
    panel.top >= panel.vh * 0.4 && panel.top <= panel.vh * 0.56,
  `面板=${panel ? `${panel.w}宽 (${panel.top}→${panel.bottom})` : 'null'} 视口=${panel?.vw}x${panel?.vh}`,
);
rec(
  '⑤ 城市面板有全屏切换钮',
  Boolean(panel) && panel.hasFsBtn,
  `全屏钮可见=${panel?.hasFsBtn}`,
);
rec(
  '⑤ 底栏单行不折行',
  Boolean(panel) && panel.barRows !== null && panel.barRows < 60,
  `底栏行高=${panel?.barRows}px(全屏面板覆盖底栏属正常)`,
);

const coarse = await m.evaluate(() => {
  const tip = document.querySelector('.hud-hovered');
  return { tipHidden: !tip || getComputedStyle(tip).display === 'none' };
});
rec('⑤ 触屏不显示跟随提示', coarse.tipHidden, `hud-hovered 隐藏=${coarse.tipHidden}`);

await m.screenshot({ path: path.join(OUT, 'v09-mobile-city.png') });

/* ---- 无运行时错误 ---- */
rec('无运行时错误', errors.length === 0, errors.slice(0, 3).join(' | ') || '0');

await browser.close();

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass !== results.length) process.exitCode = 1;
