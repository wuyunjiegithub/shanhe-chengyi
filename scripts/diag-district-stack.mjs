/**
 * 诊断：区县近景里「那块暗紫高墙」到底是什么
 * 用命中栈区分 顶盖(cap) / 侧壁(side) / 基座柱(pedestal) / 地形(terrain)
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
await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), ids[0]);
await pc.waitForTimeout(2600);

const probes = [
  [600, 400, '暗紫高墙正中'],
  [640, 300, '高墙上部'],
  [560, 480, '高墙下部'],
  [470, 330, '左侧紫区'],
  [900, 300, '右上'],
  [300, 500, '左下'],
];
for (const [x, y, note] of probes) {
  const st = await pc.evaluate(([x, y]) => window.__sandboxApp.pickStack(x, y), [x, y]);
  console.log(`\n(${x},${y}) ${note}`);
  for (const h of st) {
    console.log(`   d=${String(h.d).padStart(6)} y=${String(h.y).padStart(6)} ${h.part.padEnd(9)} ${h.kind || '-'} ${h.name || '-'}`);
  }
}

await browser.close();
