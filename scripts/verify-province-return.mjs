/**
 * 回归：ESC / 「返回」应回到**当前省份**，而不是每次都被拉回江浙沪老家视图。
 *
 * 判据（不依赖具体取景参数，只看行为）：
 *   ① 同省两个市按 ESC → 相机落点应完全一致（都落在该省）
 *   ② 跨省两个市按 ESC → 相机落点应不同
 *   ③ ESC 后的取景框应比江浙沪老家视图小（浙江 ⊂ 江浙沪皖）
 *   ④ 左下「重置俯视」→ 仍应回到江浙沪老家视图（取景框回到全量）
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const near = (a, b, eps = 0.35) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

const cam = () => pc.evaluate(() => window.__sandboxApp.debugCamera());
const frame = () => pc.evaluate(() => window.__sandboxApp.lastFrame());

// 启动会直接落在「家乡」（默认北京市）的城市视图里，所以**首屏不等于老家视图**。
// 基准必须显式建立：先点左下「重置俯视」退到区域级老家视图，再读取景尺寸。
await pc.click('.bottom-left button.ghost-pill');
await pc.waitForTimeout(2200);

/** 下钻某市 → 按 ESC → 读回相机落点 */
async function escTo(cityId) {
  await pc.evaluate((id) => window.__sandboxApp.focusCityById(id), cityId);
  await pc.waitForTimeout(2200);
  const inCity = await cam();
  await pc.keyboard.press('Escape');
  await pc.waitForTimeout(2200);
  const after = await cam();
  return { inCity, after, frame: await frame() };
}

// 江浙沪皖老家视图的取景尺寸，作为「初始地址」的基准
const home = await frame();
console.log('老家视图 lastFrame:', JSON.stringify(home));

/* ① 同省两个市（杭州 330100 / 宁波 330200，均属浙江）
   注意：宁波市是 330200；330203 是它的市辖区（江北），不是城市 id，
   用它下钻会静默失败 —— 那样 ESC 就作用在「区域级」而不是「城市级」，测的就不是这回事了。 */
const hz = await escTo('330100');
const nb = await escTo('330200');
const t1 = hz.after.target;
const t2 = nb.after.target;
console.log('杭州→ESC 落点:', t1, '框:', JSON.stringify(hz.frame));
console.log('宁波→ESC 落点:', t2, '框:', JSON.stringify(nb.frame));
rec(
  '同省两市按 ESC 落在同一处（当前省份）',
  near(t1[0], t2[0]) && near(t1[2], t2[2]),
  `Δx=${Math.abs(t1[0] - t2[0]).toFixed(2)} Δz=${Math.abs(t1[2] - t2[2]).toFixed(2)}`,
);

/* ② 跨省（江苏苏州） */
const sz = await escTo('320500');
const t3 = sz.after.target;
console.log('苏州→ESC 落点:', t3, '框:', JSON.stringify(sz.frame));
rec(
  '跨省按 ESC 落到不同地方',
  !(near(t1[0], t3[0]) && near(t1[2], t3[2])),
  `浙江 ${t1[0].toFixed(1)},${t1[2].toFixed(1)} vs 江苏 ${t3[0].toFixed(1)},${t3[2].toFixed(1)}`,
);

/* ③ ESC 后的取景框应小于江浙沪老家视图 */
const smaller =
  hz.frame.sx < home.sx - 1 && hz.frame.sz < home.sz - 1;
rec(
  'ESC 后只框住当前省（比江浙沪老家视图小）',
  smaller,
  `浙江 sx=${hz.frame.sx} sz=${hz.frame.sz} vs 老家 sx=${home.sx} sz=${home.sz}`,
);
rec('ESC 后确实动了相机（不是原地不动）', !(near(t1[0], hz.inCity.target[0]) && near(t1[2], hz.inCity.target[2])));

/* ④ 左下「重置俯视」→ 回到江浙沪老家视图 */
await pc.click('.bottom-left button.ghost-pill');
await pc.waitForTimeout(2000);
const reset = await frame();
console.log('重置俯视 lastFrame:', JSON.stringify(reset));
rec(
  '「重置俯视」回到江浙沪初始地址',
  near(reset.sx, home.sx, 1) && near(reset.sz, home.sz, 1),
  `reset sx=${reset.sx} sz=${reset.sz} vs home sx=${home.sx} sz=${home.sz}`,
);

/* ⑤ 省视角再按 ESC → 进入全国地图（取景框应显著变大，并确实动了相机）
   链路：城市 →（ESC）省 →（ESC）全国，对应 stepBack 的「区县→大市→省→全国」末一级。 */
await pc.evaluate((id) => window.__sandboxApp.focusCityById(id), '330100');
await pc.waitForTimeout(2200);
await pc.keyboard.press('Escape'); // 城市 → 省
await pc.waitForTimeout(2200);
const provFrame = await frame();
const provCam = await cam();
await pc.keyboard.press('Escape'); // 省 → 全国
await pc.waitForTimeout(2200);
const natFrame = await frame();
const natCam = await cam();
console.log('省 lastFrame:', JSON.stringify(provFrame), '全国 lastFrame:', JSON.stringify(natFrame));
rec(
  '省视角按 ESC 进入全国（取景框变大）',
  natFrame.sx > provFrame.sx + 1 && natFrame.sz > provFrame.sz + 1,
  `省 sx=${provFrame.sx} sz=${provFrame.sz} vs 全国 sx=${natFrame.sx} sz=${natFrame.sz}`,
);
rec(
  '全国视角确实动了相机（不是原地不动）',
  !(near(provCam.target[0], natCam.target[0]) && near(provCam.target[2], natCam.target[2])),
);

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
