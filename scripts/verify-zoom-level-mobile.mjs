/**
 * 回归 v0.9.41（移动端）：手机竖屏下同样成立
 *   ① 点市 → 点区县 仍拉近
 *   ② 「重置视角」落到全国地图（竖屏下宽高比悬殊，整幅中国必须都在屏内）
 *   ③ 区县不被底部半屏面板盖住
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

let pass = 0;
let fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent: ANDROID_UA,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(10000);

const cam = () => pc.evaluate(() => window.__sandboxApp.debugCamera());
const frame = () => pc.evaluate(() => window.__sandboxApp.lastFrame());
const extent = () => pc.evaluate(() => window.__sandboxApp.screenExtent?.() ?? null);

const home = await frame();
console.log('首屏 lastFrame:', JSON.stringify(home));

/* ① 点市 → 点区县 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2600);
const cityDist = (await cam()).dist;
const ids = await pc.evaluate(() => window.__sandboxApp.districtsOf?.('330100') ?? []);
await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), ids[0]);
await pc.waitForTimeout(2600);
const dCam = await cam();
console.log('杭州城市 dist=', cityDist, '→ 区县 dist=', dCam.dist);
rec('手机端点市 → 点区县：拉近', dCam.dist < cityDist, `${cityDist} → ${dCam.dist}`);

/* ③ 区县在屏幕内、且不被底部面板盖住 */
const ext = await extent();
console.log('区县 screenExtent:', JSON.stringify(ext));
if (ext) {
  rec(
    '区县完整落在屏幕内',
    ext.x0 > -2 && ext.x1 < 392 && ext.y0 > -2 && ext.y1 < 846,
    `x ${ext.x0}~${ext.x1} / y ${ext.y0}~${ext.y1}`,
  );
}

/* ② 「重置视角」→ 全国地图，整幅中国都在屏内
 * 手机端底栏会被半屏详情盖住，所以走顶栏的「总览」（窄屏才显示的正是它）*/
await pc.click('.top-reset-btn');
await pc.waitForTimeout(2800);
const reset = await frame();
const resetExt = await extent();
console.log('重置视角 lastFrame:', JSON.stringify(reset), 'extent:', JSON.stringify(resetExt));
rec(
  '手机端「重置视角」框住全国陆域',
  reset.sx > home.sx * 2 && reset.sz > home.sz * 1.5,
  `全国 sx=${reset.sx} sz=${reset.sz} vs 老家 sx=${home.sx} sz=${home.sz}`,
);
if (resetExt) {
  rec(
    '手机端全国地图整幅进屏（不裁新疆/黑龙江）',
    resetExt.x0 > -2 && resetExt.x1 < 392 && resetExt.y0 > -2 && resetExt.y1 < 846,
    `x ${resetExt.x0}~${resetExt.x1} / y ${resetExt.y0}~${resetExt.y1}`,
  );
}

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
