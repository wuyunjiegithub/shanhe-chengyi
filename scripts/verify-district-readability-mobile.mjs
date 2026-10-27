/**
 * 回归 v0.9.41（移动端）：区县近景可读性
 * 手机竖屏 390×844，底部有半屏详情面板，区县必须落在上半部分且不被遮挡。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA =
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
  userAgent: UA,
  isMobile: true,
  hasTouch: true,
});
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

const cam = () => pc.evaluate(() => window.__sandboxApp.debugCamera());
function elevOf(c) {
  const dx = c.pos[0] - c.target[0];
  const dy = c.pos[1] - c.target[1];
  const dz = c.pos[2] - c.target[2];
  return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2600);
const cityDist = (await cam()).dist;
const ids = await pc.evaluate(() => window.__sandboxApp.districtsOf?.('330100') ?? []);
const TARGET = ids[0];
await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), TARGET);
await pc.waitForTimeout(3000);

const c = await cam();
const elev = elevOf(c);
console.log(`手机: 城市 dist=${cityDist} → 区县 dist=${c.dist}  俯角=${elev.toFixed(1)}°\n`);

rec('点市 → 点区县：相机拉近', c.dist < cityDist, `城市 ${cityDist} → 区县 ${c.dist}`);

const SAMPLE = [];
for (let y = 90; y <= 700; y += 22) for (let x = 30; x <= 360; x += 22) SAMPLE.push([x, y]);
const stacks = await pc.evaluate(
  (pts) => pts.map(([x, y]) => window.__sandboxApp.pickStack(x, y)),
  SAMPLE,
);
let side = 0;
let cap = 0;
const neighbors = new Set();
for (const st of stacks) {
  const f = st[0];
  if (!f) continue;
  if (f.part === 'side') side++;
  else if (f.part === 'cap') {
    cap++;
    if (f.kind === 'district' && f.id !== TARGET) neighbors.add(f.name);
  }
}
const sideRatio = side / SAMPLE.length;
console.log(`侧壁占比 ${(sideRatio * 100).toFixed(1)}%   顶盖占比 ${((cap / SAMPLE.length) * 100).toFixed(1)}%`);
// 阈值 12%：手机竖屏视野窄，同样俯角下近端区块的侧壁占比天然高于桌面。
// 这里留 ~10% 是正常的立体感（邻区朝向相机那侧的侧壁），不是「一堵墙」的遮挡 ——
// 修复前是 17.2%，且视觉上是一大片暗紫近黑色块把邻近区县全挡住。
rec('近景里侧壁不再主导画面（< 12%）', sideRatio < 0.12, `side=${(sideRatio * 100).toFixed(1)}%`);
rec('顶面是画面主体（> 50%）', cap / SAMPLE.length > 0.5, `cap=${((cap / SAMPLE.length) * 100).toFixed(1)}%`);

const ext = await pc.evaluate((id) => window.__sandboxApp.districtScreenExtent(id), TARGET);
console.log(`选中区县屏幕范围: ${ext ? `${ext.x0}~${ext.x1} × ${ext.y0}~${ext.y1}` : 'null'}`);
rec('选中区县在屏幕上足够大', !!ext && ext.x1 - ext.x0 > 90 && ext.y1 - ext.y0 > 90, ext ? `${(ext.x1 - ext.x0).toFixed(0)}×${(ext.y1 - ext.y0).toFixed(0)}px` : 'null');
rec('选中区县完整落在屏幕内', !!ext && ext.x0 >= 0 && ext.y0 >= 0 && ext.x1 <= 390 && ext.y1 <= 844, ext ? `x ${ext.x0}~${ext.x1} / y ${ext.y0}~${ext.y1}` : 'null');
rec('俯角够陡（≥ 60°）', elev >= 60, `elev=${elev.toFixed(1)}°`);
rec('邻近区县仍可读', neighbors.size >= 2, `${neighbors.size} 个: ${[...neighbors].slice(0, 5).join('、')}`);

await pc.screenshot({ path: 'scripts/.cache/mobile-district-after.png' });
console.log('截图: scripts/.cache/mobile-district-after.png');

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
