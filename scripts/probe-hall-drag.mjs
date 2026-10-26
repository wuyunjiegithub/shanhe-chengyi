/**
 * 3D 照片空间：视角自由度探针
 * 1) 上下拖动确实改变俯仰角（能看上层 / 下层），并停在 ±8° 的安全边界内，不会翻到极点打转；
 * 2) 右键拖 = 平移，目标点会移动（前后左右走进去），且被夹在照片世界内部；
 * 3) 自动漫游不是只水平转：俯仰角与半径都要发生变化。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:1421/out/_probe/hall.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const open = async (q) => {
  await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__hall3d, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
};
const cam = () => page.evaluate(() => window.__hall3d.cam());
const drag = async (from, to, button = 'left') => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down({ button });
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button });
  await page.waitForTimeout(800);
};

const fails = [];

// ---------- 1. 俯仰 ----------
await open('n=60');
const limits = await page.evaluate(() => window.__hall3d.polarLimits);
const a0 = await cam();
await drag([640, 640], [640, 60]); // 大幅向上拖，应该顶到下限
const a1 = await cam();
await drag([640, 60], [640, 700]); // 大幅向下拖，顶到上限
const a2 = await cam();
console.log('极角边界      ', limits);
console.log('向上拖到底    ', `polar=${a1.polar} y=${a1.y}`);
console.log('向下拖到底    ', `polar=${a2.polar} y=${a2.y}`);
if (!(Math.abs(a1.polar - a0.polar) > 0.3 || Math.abs(a2.polar - a0.polar) > 0.3))
  fails.push('上下拖动没有改变俯仰角');
if (a1.polar < limits[0] - 1e-3 || a2.polar > limits[1] + 1e-3) fails.push('俯仰越过了安全边界');
if (Math.abs(a1.y - a0.y) < 1) fails.push('上下拖动没有改变机位高度');

// ---------- 2. 平移 ----------
await open('n=60');
const b0 = await cam();
await drag([640, 500], [300, 300], 'right');
const b1 = await cam();
const tMove = Math.hypot(b1.tx - b0.tx, b1.ty - b0.ty, b1.tz - b0.tz);
const R = await page.evaluate(() => window.__hall3d.radius);
const tLen = Math.hypot(b1.tx, b1.ty, b1.tz);
console.log('右键拖后目标点', `Δ=${tMove.toFixed(2)} |target|=${tLen.toFixed(2)} (上限 ${(R * 0.9).toFixed(2)})`);
if (tMove < 0.5) fails.push('右键拖动没能平移（前后左右走不进去）');
if (tLen > R * 0.9 + 0.05) fails.push('平移越出了照片世界范围');

// ---------- 3. 漫游 ----------
await open('n=60&tour=1');
const samples = [];
for (let i = 0; i < 6; i++) {
  samples.push(await cam());
  await page.waitForTimeout(1400);
}
const phis = samples.map((s) => s.polar);
const rs = samples.map((s) => s.dist);
const azs = samples.map((s) => s.azimuth);
const dPhi = Math.max(...phis) - Math.min(...phis);
const dR = Math.max(...rs) - Math.min(...rs);
const dAz = Math.max(...azs) - Math.min(...azs);
console.log('漫游 6 次采样 ', `Δpolar=${dPhi.toFixed(3)} Δdist=${dR.toFixed(2)} Δazimuth=${dAz.toFixed(3)}`);
if (dAz < 0.05) fails.push('漫游没有水平环绕');
if (dPhi < 0.05) fails.push('漫游仍然只在水平面上转（俯仰没动）');
if (dR < 0.5) fails.push('漫游没有前后进退（距离没变）');

if (errors.length) console.log('页面异常:', errors[0]);
console.log(fails.length ? `FAIL\n - ${fails.join('\n - ')}` : 'PASS 上下 / 前后 / 漫游 都正常');
await browser.close();
process.exit(fails.length ? 1 : 0);
