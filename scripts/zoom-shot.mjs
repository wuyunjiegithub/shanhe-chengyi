// 用浏览器 canvas 裁剪放大截图局部
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const BOX = process.env.BOX
  ? (() => { const [x, y, w, h] = process.env.BOX.split(',').map(Number); return { x, y, w, h }; })()
  : { x: 640, y: 480, w: 400, h: 400 };
const ZOOM = Number(process.env.ZOOM || 2);

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: BOX.w * ZOOM, height: BOX.h * ZOOM } });

for (const name of process.argv.slice(2)) {
  const p = path.resolve(`regression-shots/${name}.png`);
  await page.goto('file:///' + p.replace(/\\/g, '/'));
  await page.evaluate((box) => {
    const img = document.querySelector('img');
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.background = '#111';
    const cv = document.createElement('canvas');
    cv.width = box.w * 2;
    cv.height = box.h * 2;
    cv.style.width = cv.width + 'px';
    cv.style.height = cv.height + 'px';
    cv.style.imageRendering = 'pixelated';
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w * 2, box.h * 2);
    document.body.appendChild(cv);
  }, BOX);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.resolve(`regression-shots/zoom-${name}.png`) });
  console.log('zoomed', name);
}
await browser.close();
