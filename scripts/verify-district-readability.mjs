/**
 * 回归 v0.9.41：区县近景的可读性
 *
 * 用户报的问题：「点市区放大，接着点区县反而缩小了」——修复后引出一个新的视觉问题：
 * 拉近了才发现选中区县的**侧壁**（1 单位 ≈ 50km 假高度）正对相机，
 * 在画面中央形成一堵暗紫近黑的高墙，把邻近区县的顶盖全挡住。
 *
 * ① 点市 → 点区县必须严格拉近（且不能拉得太狠）
 * ② 近景里侧壁（side）占画面比例必须够低（< 8%），否则又变回「一堵墙」
 * ③ 选中区县的顶面在屏幕上必须够大（读得出形状）
 * ④ 俯角必须够陡（≥ 60°），否则侧壁压不住
 * ⑤ 邻近区县必须还在画面里（读得出方位）
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
/** 由相机位置与目标算出俯角（度） */
function elevOf(c) {
  const dx = c.pos[0] - c.target[0];
  const dy = c.pos[1] - c.target[1];
  const dz = c.pos[2] - c.target[2];
  return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

/* 下钻杭州 → 选中上城区 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2400);
const cityDist = (await cam()).dist;
const ids = await pc.evaluate(() => window.__sandboxApp.districtsOf?.('330100') ?? []);
const TARGET = ids[0];
await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), TARGET);
await pc.waitForTimeout(3000);

const c = await cam();
const elev = elevOf(c);
console.log(`城市 dist=${cityDist} → 区县 dist=${c.dist}  俯角=${elev.toFixed(1)}°  目标=${TARGET}\n`);

/* ① 严格拉近 */
rec(
  '点市 → 点区县：相机拉近',
  c.dist < cityDist,
  `城市 ${cityDist} → 区县 ${c.dist}`,
);
rec(
  '区县距离不是贴脸（保留可读范围）',
  c.dist > cityDist * 0.05,
  `dist=${c.dist}`,
);

/* ② 侧壁占画面比例 */
const SAMPLE = [];
for (let y = 90; y <= 820; y += 26) for (let x = 260; x <= 1030; x += 26) SAMPLE.push([x, y]);
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
const capRatio = cap / SAMPLE.length;
console.log(`侧壁占比 ${(sideRatio * 100).toFixed(1)}%   顶盖占比 ${(capRatio * 100).toFixed(1)}%`);
rec(
  '近景里侧壁不再主导画面（< 8%）',
  sideRatio < 0.08,
  `side=${(sideRatio * 100).toFixed(1)}%`,
);
rec(
  '顶面是画面主体（> 55%）',
  capRatio > 0.55,
  `cap=${(capRatio * 100).toFixed(1)}%`,
);

/* ③ 选中区县在屏幕上的尺寸 */
const ext = await pc.evaluate((id) => window.__sandboxApp.districtScreenExtent(id), TARGET);
console.log(`选中区县屏幕范围: ${ext ? `${ext.x0}~${ext.x1} × ${ext.y0}~${ext.y1}` : 'null'}`);
rec(
  '选中区县在屏幕上足够大（读得出形状）',
  !!ext && ext.x1 - ext.x0 > 150 && ext.y1 - ext.y0 > 150,
  ext ? `${(ext.x1 - ext.x0).toFixed(0)}×${(ext.y1 - ext.y0).toFixed(0)}px` : 'null',
);
rec(
  '选中区县完整落在屏幕内',
  !!ext && ext.x0 > 0 && ext.y0 > 0 && ext.x1 < 1440 && ext.y1 < 900,
  ext ? `x ${ext.x0}~${ext.x1} / y ${ext.y0}~${ext.y1}` : 'null',
);

/* ④ 俯角够陡 */
rec(
  '俯角够陡（≥ 60°，压住侧壁）',
  elev >= 60,
  `elev=${elev.toFixed(1)}°`,
);

/* ⑤ 邻近区县可见 */
console.log(`画面内的邻近区县: ${[...neighbors].join('、')}`);
rec(
  '邻近区县仍可读（读得出方位）',
  neighbors.size >= 3,
  `${neighbors.size} 个: ${[...neighbors].slice(0, 6).join('、')}`,
);

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
