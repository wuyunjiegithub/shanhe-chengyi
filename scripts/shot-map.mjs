/** 单独截一张地图主视图，用来目视检查光泽/高光效果（PC + 移动端各一张）。 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://127.0.0.1:1422/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });

/* ---- PC ---- */
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(7000);
await pc.screenshot({ path: path.join(OUT, 'map-gloss-pc.png') });

/* ---- 移动端 ---- */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForTimeout(7000);
await m.screenshot({ path: path.join(OUT, 'map-gloss-mobile.png') });

await browser.close();
console.log('截图完成: map-gloss-pc.png / map-gloss-mobile.png');
