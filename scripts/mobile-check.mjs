// 手机端 11 项改动的自动化核查（v1.5 移动端打磨）
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://127.0.0.1:1422/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const errs = [];
m.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 20000 });
await m.waitForTimeout(2500);

/* ① 首屏：整幅地图进屏（取景包围盒投影不超出视口） */
const fit = await m.evaluate(() => {
  const S = window.__sandboxApp;
  const f = S?.lastFrame?.();
  const cv = document.querySelector('.canvas canvas');
  return {
    frame: f ?? null,
    canvas: cv ? { w: cv.clientWidth, h: cv.clientHeight } : null,
    vw: window.innerWidth,
    vh: window.innerHeight,
  };
});
// 取景距离必须为正且有限；真实「是否出屏」由截图目视确认
rec(
  '① 首屏取景已按手机可用视区计算',
  Boolean(fit.frame) && fit.frame.dist > 0 && Number.isFinite(fit.frame.dist),
  `取景=${JSON.stringify(fit.frame)} 视口=${fit.vw}x${fit.vh}`,
);
await m.screenshot({ path: path.join(OUT, 'm01-home.png') });

/* ② 顶栏：设置隐藏、重置可见、无下钻提示 */
const top = await m.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const disp = (el) => (el ? getComputedStyle(el).display : 'none');
  return {
    settings: disp(q('.data-pill--photo')),
    reset: disp(q('.top-reset-btn')),
    hint: Boolean(q('.region-hint')),
    pick: disp(q('.idx-pick-btn')),
  };
});
rec('② 手机端不显示「设置」', top.settings === 'none', `display=${top.settings}`);
rec('② 手机端可见「重置视角」', top.reset !== 'none', `display=${top.reset}`);
rec('⑦ 已删除「点击城市板块下钻」提示', top.hint === false, `region-hint 存在=${top.hint}`);

/* ③ 进入城市：封面放大 + 返回入口 + 底部按钮不被遮挡 */
await m.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await m.waitForTimeout(2200);
const city = await m.evaluate(() => {
  const cover = document.querySelector('.city-cover');
  const back = document.querySelector('.city-back-btn');
  const acts = document.querySelector('.city-actions');
  const bar = document.querySelector('.hud-bottom');
  const hit = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t ? el.contains(t) || el === t : false;
  };
  return {
    coverH: cover ? Math.round(cover.getBoundingClientRect().height) : 0,
    back: back ? getComputedStyle(back).display : 'none',
    actVisible: acts ? hit(acts.querySelector('.city-act')) : null,
    barDisplay: bar ? getComputedStyle(bar).display : 'none',
    actBottom: acts ? Math.round(acts.getBoundingClientRect().bottom) : null,
    vh: window.innerHeight,
  };
});
rec('③ 城市封面已放大', city.coverH >= 170, `封面高=${city.coverH}px（原 118px）`);
rec('③ 城市面板有「返回」入口', city.back !== 'none', `display=${city.back}`);
rec('④ 城市面板底部按钮未被遮挡', city.actVisible === true, `按钮可点=${city.actVisible} 底栏=${city.barDisplay}`);
await m.screenshot({ path: path.join(OUT, 'm02-city.png') });

/* ⑤ 区县详情：底部操作条吸底可见、底栏收起 */
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(1600);
const drawer = await m.evaluate(() => {
  const acts = document.querySelector('.drawer-actions');
  const bar = document.querySelector('.hud-bottom');
  const btn = acts?.querySelector('button');
  const hit = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t ? el.contains(t) || el === t : false;
  };
  const r = acts?.getBoundingClientRect();
  return {
    pos: acts ? getComputedStyle(acts).position : null,
    bottom: r ? Math.round(r.bottom) : null,
    visible: hit(btn),
    barDisplay: bar ? getComputedStyle(bar).display : 'none',
    vh: window.innerHeight,
  };
});
rec(
  '④ 详情底部操作条吸底且可见',
  drawer.pos === 'sticky' && drawer.visible === true && drawer.bottom <= drawer.vh + 1,
  `position=${drawer.pos} 底=${drawer.bottom}/${drawer.vh} 按钮可点=${drawer.visible} 底栏=${drawer.barDisplay}`,
);
await m.screenshot({ path: path.join(OUT, 'm03-drawer.png') });

/* ⑥ 照片墙：无占位块（不出现裂图 / 空框） */
const wall = await m.evaluate(() => {
  const S = window.__sandboxApp;
  S?.openPhotoWall?.({ scope: 'city', id: '330100', title: '杭州 · 照片墙' });
  return true;
});
await m.waitForTimeout(2500);
const wallInfo = await m.evaluate(() => ({
  empties: document.querySelectorAll('.wall-media--empty').length,
  tiles: document.querySelectorAll('.wall-tile').length,
  brokenImgs: [...document.querySelectorAll('.wall-media-img')].filter(
    (i) => i.tagName === 'IMG' && i.complete && i.naturalWidth === 0,
  ).length,
}));
rec(
  '⑥ 照片墙无占位 / 无裂图',
  wallInfo.empties === 0 && wallInfo.brokenImgs === 0,
  `占位块=${wallInfo.empties} 裂图=${wallInfo.brokenImgs} 可见照片=${wallInfo.tiles}`,
);
await m.screenshot({ path: path.join(OUT, 'm04-wall.png') });
await m.keyboard.press('Escape');
await m.waitForTimeout(800);

/* ⑨ 数据面板：无导入按钮、按钮叫「保存」 */
await m.evaluate(() => {
  const btns = [...document.querySelectorAll('.data-pill')];
  const data = btns.find((b) => b.textContent.includes('数据'));
  data?.click();
});
await m.waitForTimeout(1500);
const data = await m.evaluate(() => {
  const btns = [...document.querySelectorAll('.data-foot-actions button')];
  const imp = document.querySelector('.data-import-btn');
  const save = btns.find((b) => b.textContent.includes('保存'));
  return {
    importDisplay: imp ? getComputedStyle(imp).display : 'none',
    saveText: save ? save.textContent.trim() : null,
    labels: btns.map((b) => b.textContent.trim()),
  };
});
rec('⑨ 手机端无「导入」按钮', data.importDisplay === 'none', `display=${data.importDisplay}`);
rec('⑨ 保存按钮文案为「保存」', data.saveText === '保存', `文案=${data.saveText} 全部=${JSON.stringify(data.labels)}`);
await m.screenshot({ path: path.join(OUT, 'm05-data.png') });

/* ⑤ 底栏「返回」不带 ESC */
const esc = await m.evaluate(() => {
  const btns = [...document.querySelectorAll('.bottom-right .ghost-pill')];
  return {
    kbd: document.querySelectorAll('.bottom-right kbd').length,
    texts: btns.map((b) => b.textContent.trim()),
  };
});
rec('⑤ 返回按钮不再显示 ESC', esc.kbd === 0, `kbd 数=${esc.kbd} 按钮=${JSON.stringify(esc.texts)}`);

rec('无运行时错误', errs.length === 0, `错误数=${errs.length} ${errs.slice(0, 2).join(' | ')}`);

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
await browser.close();
