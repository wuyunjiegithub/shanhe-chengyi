/** 3D 照片空间：平移之后点照片，聚焦时那张仍要落在画面正中、且大小恒定（不跑到镜头后面） */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:1421/out/_probe/hall.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?n=60`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__hall3d, null, { timeout: 30000 });
await page.waitForTimeout(2500);

const drag = async (from, to, button = 'left') => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down({ button });
  for (let i = 1; i <= 18; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 18, from[1] + ((to[1] - from[1]) * i) / 18);
    await page.waitForTimeout(16);
  }
  await page.mouse.up({ button });
  await page.waitForTimeout(800);
};

// 先平移 + 抬到斜上方：目标点离开原点，验证聚焦定位不再假设「世界中心就在镜头正前方」
await drag([640, 500], [340, 300], 'right');
await drag([640, 620], [640, 470]);

// 点开一张（用探针注入序号，避免点空）
await page.evaluate(() => window.__setFocus(0));
await page.waitForTimeout(1600);

const st = await page.evaluate(() => window.__hall3d.cam());
// 聚焦照片应当出现在画面正中：把它的世界坐标投到屏幕上量一下
const proj = await page.evaluate(() => {
  const m = window.__hall3d;
  return m.focusScreen ? m.focusScreen() : null;
});
console.log('相机       ', st);
console.log('聚焦投影   ', proj);

const ok = !!proj && Math.abs(proj.x - 640) < 40 && Math.abs(proj.y - 400) < 60 && proj.z > 0;
console.log(ok ? 'PASS 平移后聚焦仍居中' : 'FAIL 聚焦跑偏（或被推到镜头后面）');
if (errors.length) console.log('页面异常:', errors[0]);
await page.screenshot({ path: 'regression-shots/hall-focus-panned.png' });
await browser.close();
process.exit(ok ? 0 : 1);
