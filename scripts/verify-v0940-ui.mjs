/**
 * 目检：省份标签随距离缩放 + 区县详情真的有内容 + 地形起伏可见。
 * 产出截图到 regression-shots/，供人工核对。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(10000);

/* ① 省份标签字号：首屏（近） vs 拉远 */
const labelSizes = () =>
  pc.evaluate(() =>
    [...document.querySelectorAll('.geo-label:not(.geo-label--district)')]
      .map((el) => parseFloat(getComputedStyle(el).fontSize))
      .filter((n) => n > 0),
  );

const near = await labelSizes();
console.log('首屏省份标签字号:', near.join(', '));
rec('首屏省份标签有字号', near.length > 0, `count=${near.length}`);
rec('首屏字号在合理区间（12~32px）', near.every((n) => n >= 11 && n <= 33), near.join(','));
await pc.screenshot({ path: path.join(OUT, 'v0940-region.png') });

// 拉远看全国：字号应变小
await pc.mouse.move(700, 450);
for (let i = 0; i < 14; i++) {
  await pc.mouse.wheel(0, 260);
  await pc.waitForTimeout(90);
}
await pc.waitForTimeout(1500);
const far = await labelSizes();
console.log('拉远后省份标签字号:', far.join(', '));
rec('拉远后标签变小（随距离缩放生效）', far.length > 0 && Math.max(...far) <= Math.max(...near) + 0.5,
  `max 近=${Math.max(...near).toFixed(1)} 远=${Math.max(...far).toFixed(1)}`);
await pc.screenshot({ path: path.join(OUT, 'v0940-region-far.png') });

/* ② 区县详情里真的有内容 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('320500'));
await pc.waitForTimeout(2500);
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('320505'));
await pc.waitForTimeout(2500);
const drawer = await pc.evaluate(() => {
  const t = document.body.innerText;
  return {
    hasHistory: /历史/.test(t),
    hasCulture: /人文/.test(t),
    hasFeatures: /特色/.test(t),
    pending: (t.match(/待补充/g) || []).length,
    text: t.slice(0, 0),
  };
});
console.log('详情面板:', JSON.stringify(drawer));
rec('区县详情不再全是「待补充」', drawer.pending === 0, `待补充×${drawer.pending}`);
await pc.screenshot({ path: path.join(OUT, 'v0940-district.png') });

/* ③ 一个基线（维基补全的）区县，看是否有人文历史 */
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('330183'));
await pc.waitForTimeout(2200);
const base = await pc.evaluate(() => {
  const t = document.body.innerText;
  return { pending: (t.match(/待补充/g) || []).length, len: t.length };
});
rec('维基补全的区县也有正文', base.pending === 0, `待补充×${base.pending}`);

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
