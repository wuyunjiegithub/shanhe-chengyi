/**
 * 诊断：上海一带海岸线上的品红锯齿（疑似板块 / 地形 z-fighting）。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(10000);

// 关掉地形图层，看品红是板块还是地形
const shot = async (name) => {
  await pc.waitForTimeout(1200);
  await pc.screenshot({ path: path.join(OUT, `shanghai-${name}.png`) });
};

await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('地形'));
  btn?.click();
});
await shot('no-terrain');
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('地形'));
  btn?.click();
});
await shot('with-terrain');

// 放大到上海
await pc.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await pc.waitForTimeout(3000);
await shot('shanghai-city');

await browser.close();
console.log('截图完成');
