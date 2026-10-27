/**
 * 回归 v0.9.41：层级下钻的缩放方向 + 「重置视角」的目标
 *
 * ① 点市 → 点区县，相机距离必须**变小**（拉近），不能反向拉远
 *    （用户原话：「为什么我点市区放大，接着点区县反而缩小了，应该视角拉更近才对」）
 * ② 「重置视角」（指南针 / 顶栏「总览」）必须落到**全国地图**，不是江浙沪老家视图
 * ③ 左下「重置俯视 50°」仍回江浙沪老家视图（v0.9.40 契约，不被 ② 牵连）
 * ④ 多个城市分别验证 ①（不能只对杭州成立）
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

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

const cam = () => pc.evaluate(() => window.__sandboxApp.debugCamera());
const frame = () => pc.evaluate(() => window.__sandboxApp.lastFrame());

/** 下钻某市 → 选一个区县 → 返回 {cityDist, districtDist} */
async function drill(cityId) {
  await pc.evaluate((id) => window.__sandboxApp.focusCityById(id), cityId);
  await pc.waitForTimeout(2400);
  const cityDist = (await cam()).dist;
  const ids = await pc.evaluate((id) => window.__sandboxApp.districtsOf?.(id) ?? [], cityId);
  if (!ids.length) return null;
  const pick = ids[0];
  await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), pick);
  await pc.waitForTimeout(2400);
  const d = await cam();
  return { cityDist, districtDist: d.dist, pick, frame: d.lastFrame };
}

/* 江浙沪老家视图基准。
   注意：启动会直接落在「家乡」（默认北京市）的城市视图里，首屏**不等于**老家视图，
   所以基准必须先点一次左下「重置俯视」退到区域级老家视图再读。 */
await pc.click('.bottom-left button.ghost-pill');
await pc.waitForTimeout(2200);
const home = await frame();
console.log('老家视图 lastFrame:', JSON.stringify(home));

/* ① 点市 → 点区县，距离必须变小 */
const hz = await drill('330100');
console.log('杭州:', JSON.stringify(hz));
rec(
  '点市 → 点区县：相机拉近（dist 变小）',
  hz && hz.districtDist < hz.cityDist,
  hz ? `城市 ${hz.cityDist} → 区县 ${hz.districtDist}` : '未取到数据',
);

/* ④ 换一个城市再验一次（宁波：辖区形状与杭州不同） */
const nb = await drill('330200');
console.log('宁波:', JSON.stringify(nb));
rec(
  '点市 → 点区县（第二个城市）同样拉近',
  nb && nb.districtDist < nb.cityDist,
  nb ? `城市 ${nb.cityDist} → 区县 ${nb.districtDist}` : '未取到数据',
);

/* ② 「重置视角」（指南针）→ 全国地图 */
await pc.click('.bottom-right button.compass');
await pc.waitForTimeout(2600);
const reset = await frame();
const resetCam = await cam();
console.log('重置视角 lastFrame:', JSON.stringify(reset), 'target:', resetCam.target);
rec(
  '「重置视角」框住的是全国陆域（远大于江浙沪老家视图）',
  reset.sx > home.sx * 2 && reset.sz > home.sz * 1.5,
  `全国 sx=${reset.sx} sz=${reset.sz} vs 老家 sx=${home.sx} sz=${home.sz}`,
);
rec(
  '「重置视角」后相机退到很远（全国尺度）',
  reset.dist > 60,
  `dist=${reset.dist}`,
);

/* 顶栏「总览」也应是全国（该按钮只在窄屏显示，桌面用调试钩子触发同一函数） */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2400);
await pc.evaluate(() => window.__sandboxApp.goToOverview());
await pc.waitForTimeout(2600);
const overview = await frame();
console.log('顶栏总览 lastFrame:', JSON.stringify(overview));
rec(
  '顶栏「总览」同样落到全国地图',
  overview.sx > home.sx * 2 && overview.dist > 60,
  `sx=${overview.sx} dist=${overview.dist}`,
);

/* ③ 左下「重置俯视 50°」仍回江浙沪老家视图 */
await pc.click('.bottom-left button.ghost-pill');
await pc.waitForTimeout(2400);
const resetHome = await frame();
console.log('重置俯视 lastFrame:', JSON.stringify(resetHome));
rec(
  '左下「重置俯视」仍回江浙沪初始地址（不被「重置视角」牵连）',
  Math.abs(resetHome.sx - home.sx) < 1 && Math.abs(resetHome.sz - home.sz) < 1,
  `reset sx=${resetHome.sx} sz=${resetHome.sz} vs home sx=${home.sx} sz=${home.sz}`,
);

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
