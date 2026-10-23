// v1.18 手机端四项修复核查：半屏可滑下 / 内容编辑器可选省市区 / 去「校验通过」/ 照片墙不顶状态栏
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

const ty = (transform) => {
  if (!transform || transform === 'none') return 0;
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const p = m[1].split(',').map(Number);
  return Math.round(p[5]);
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

/* ① 区县详情：抓手存在、可点按收起、可下滑收起 */
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 });
await m.waitForTimeout(1200);

const grab1 = await m.evaluate(() => {
  const g = document.querySelector('.drawer .sheet-grabber');
  return {
    exists: !!g,
    display: g ? getComputedStyle(g).display : 'none',
    rect: g ? g.getBoundingClientRect() : null,
    drawerTy: getComputedStyle(document.querySelector('.drawer')).transform,
  };
});
rec('① 区县详情抓手存在且手机端显示', grab1.exists && grab1.display === 'flex', `display=${grab1.display}`);
rec('① 初始展开态 translateY≈0', ty(grab1.drawerTy) <= 2, `ty=${ty(grab1.drawerTy)}`);

const dragDown = async (g) => {
  const x = g.left + g.width / 2;
  const y = g.top + g.height / 2;
  await m.mouse.move(x, y);
  await m.mouse.down();
  await m.mouse.move(x, y + 260, { steps: 14 });
  await m.mouse.up();
  await m.waitForTimeout(450);
  return ty(await m.evaluate(() => getComputedStyle(document.querySelector('.drawer')).transform));
};

// 下滑手势收起（核心需求：手动滑下去看地图）
const tyDown = await dragDown(grab1.rect);
rec('① 下滑手势收起（translateY>50）', tyDown > 50, `ty=${tyDown}`);
await m.screenshot({ path: path.join(OUT, 'v118-drawer-peek.png') });

// 点按切换：用零位移合成 pointer 事件精确验证「点按切换」逻辑（无头首次点按有抖动，先热身一次）
const tapGrabber = async () => {
  await m.evaluate(() => {
    const g = document.querySelector('.drawer .sheet-grabber');
    const r = g.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opt = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch' };
    g.dispatchEvent(new PointerEvent('pointerdown', opt));
    g.dispatchEvent(new PointerEvent('pointerup', opt));
  });
  await m.waitForTimeout(450);
  return ty(await m.evaluate(() => getComputedStyle(document.querySelector('.drawer')).transform));
};
await tapGrabber(); // 热身
// 当前为收起态（peek），点按应展开
const tapExpand = await tapGrabber();
rec('① 点按展开（translateY≈0）', tapExpand <= 2, `ty=${tapExpand}`);
// 再点按应重新收起
const tapCollapse = await tapGrabber();
rec('① 点按收起（translateY>50）', tapCollapse > 50, `ty=${tapCollapse}`);

/* ② 城市概览：抓手存在 */
await m.keyboard.press('Escape');
await m.waitForTimeout(600);
await m.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await m.waitForTimeout(1500);
const cityGrab = await m.evaluate(() => {
  const g = document.querySelector('.city-panel .sheet-grabber');
  return { exists: !!g, display: g ? getComputedStyle(g).display : 'none' };
});
rec('② 城市概览抓手存在且显示', cityGrab.exists && cityGrab.display === 'flex', `display=${cityGrab.display}`);
await m.keyboard.press('Escape');
await m.waitForTimeout(600);

/* ③ 内容编辑器（数据面板）：手机端省市区列表可见、无「校验通过」 */
await m.evaluate(() => {
  const b = [...document.querySelectorAll('.data-pill')].find((x) => x.textContent.includes('数据'));
  b?.click();
});
await m.waitForTimeout(1200);
const data = await m.evaluate(() => {
  const rail = document.querySelector('.data-rail');
  const val = document.querySelector('.data-validation');
  return {
    railDisplay: rail ? getComputedStyle(rail).display : 'none',
    railVisible: rail ? rail.getBoundingClientRect().height > 20 : false,
    validationText: val ? val.textContent : '',
  };
});
rec('③ 手机端 data-rail 可见（非 none）', data.railDisplay !== 'none' && data.railVisible, `display=${data.railDisplay}`);
rec('③ 已移除「校验通过」', !data.validationText.includes('校验通过'), `校验区文案=${JSON.stringify(data.validationText.trim())}`);
await m.screenshot({ path: path.join(OUT, 'v118-data.png') });

/* ④ 照片墙：头部上内边距含安全区（>=12，不再是被覆盖的 10） */
await m.keyboard.press('Escape');
await m.waitForTimeout(500);
await m.evaluate(() => window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州 · 照片墙' }));
await m.waitForTimeout(1500);
const wall = await m.evaluate(() => {
  const h = document.querySelector('.wall-head');
  return { pt: h ? parseFloat(getComputedStyle(h).paddingTop) : -1 };
});
rec('④ 照片墙头部上内边距>=12（不顶状态栏）', wall.pt >= 12, `paddingTop=${wall.pt}px`);
await m.screenshot({ path: path.join(OUT, 'v118-wall.png') });

rec('无运行时错误', errs.length === 0, `错误数=${errs.length} ${errs.slice(0, 2).join(' | ')}`);

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
await browser.close();
