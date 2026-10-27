/**
 * 参数扫描（第二轮）：陡俯角 + 放开距离下限
 *
 * 目标：侧壁占比压到 5% 以内，同时让选中区县在屏幕上足够大（读得出形状）。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2400);
const ids = await pc.evaluate(() => window.__sandboxApp.districtsOf?.('330100') ?? []);
const TARGET = ids[0];
await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), TARGET);
await pc.waitForTimeout(2600);

const SAMPLE = [];
for (let y = 90; y <= 820; y += 26) for (let x = 260; x <= 1030; x += 26) SAMPLE.push([x, y]);

async function measure(label) {
  await pc.waitForTimeout(1400);
  const stacks = await pc.evaluate(
    (pts) => pts.map(([x, y]) => window.__sandboxApp.pickStack(x, y)),
    SAMPLE,
  );
  let side = 0;
  let cap = 0;
  let terr = 0;
  for (const st of stacks) {
    const f = st[0];
    if (!f) continue;
    if (f.part === 'side') side++;
    else if (f.part === 'cap') cap++;
    else if (f.part === 'terrain') terr++;
  }
  const cam = await pc.evaluate(() => window.__sandboxApp.debugCamera());
  const ext = await pc.evaluate((id) => window.__sandboxApp.districtScreenExtent(id), TARGET);
  const n = SAMPLE.length;
  const pct = (v) => ((v / n) * 100).toFixed(1).padStart(5);
  const w = ext ? (ext.x1 - ext.x0).toFixed(0) : '-';
  const h = ext ? (ext.y1 - ext.y0).toFixed(0) : '-';
  console.log(
    `${label.padEnd(40)} side=${pct(side)}% cap=${pct(cap)}% terr=${pct(terr)}%  dist=${String(cam.dist).padStart(5)}  ext=${w}x${h}`,
  );
  return { side: side / n, cap: cap / n, dist: cam.dist, ext };
}

console.log(`目标: ${TARGET}  采样 ${SAMPLE.length} 点\n`);

const COMBOS = [
  { elev: 70, lift: 0.78, factor: 2.6, minRatio: 0.3 },
  { elev: 70, lift: 0.5, factor: 2.6, minRatio: 0.22 },
  { elev: 70, lift: 0.5, factor: 1.6, minRatio: 0.18 },
  { elev: 70, lift: 0.35, factor: 1.3, minRatio: 0.14 },
  { elev: 70, lift: 0.35, factor: 1.15, minRatio: 0.1 },
  { elev: 66, lift: 0.35, factor: 1.3, minRatio: 0.14 },
  { elev: 62, lift: 0.35, factor: 1.3, minRatio: 0.14 },
  { elev: 70, lift: 0.2, factor: 1.3, minRatio: 0.14 },
];

for (const c of COMBOS) {
  await pc.evaluate((o) => window.__sandboxApp.tuneDistrictFocus(o), c);
  await measure(`e${c.elev} l${c.lift} f${c.factor} m${c.minRatio}`);
}

await browser.close();
