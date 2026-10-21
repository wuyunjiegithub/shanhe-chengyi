// 像素级 diff：对比悬浮前后的差异区域
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const a = path.resolve('regression-shots/k1-before.png').replace(/\\/g, '/');
const b = path.resolve('regression-shots/k2-hover.png').replace(/\\/g, '/');
await page.goto('file:///' + a);
await page.evaluate((bUrl) => {
  const imgA = document.querySelector('img');
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  load(bUrl).then((imgB) => {
    const cv = document.createElement('canvas');
    cv.width = 1440; cv.height = 900;
    const ctx = cv.getContext('2d');
    ctx.drawImage(imgA, 0, 0);
    const dA = ctx.getImageData(0, 0, 1440, 900);
    ctx.clearRect(0, 0, 1440, 900);
    ctx.drawImage(imgB, 0, 0);
    const dB = ctx.getImageData(0, 0, 1440, 900);
    const out = ctx.createImageData(1440, 900);
    let minX = 1440, maxX = 0, minY = 900, maxY = 0, count = 0;
    for (let i = 0; i < dA.data.length; i += 4) {
      const dr = Math.abs(dA.data[i] - dB.data[i]);
      const dg = Math.abs(dA.data[i + 1] - dB.data[i + 1]);
      const db = Math.abs(dA.data[i + 2] - dB.data[i + 2]);
      const diff = dr + dg + db;
      const px = (i / 4) % 1440, py = Math.floor(i / 4 / 1440);
      if (diff > 30) {
        count++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        out.data[i] = 255; out.data[i + 1] = 60; out.data[i + 2] = 60; out.data[i + 3] = 255;
      } else if (diff > 8) {
        out.data[i] = 255; out.data[i + 1] = 200; out.data[i + 2] = 60; out.data[i + 3] = 140;
      } else {
        out.data[i] = 20; out.data[i + 1] = 24; out.data[i + 2] = 32; out.data[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.appendChild(cv);
    window.__diff = { minX, maxX, minY, maxY, count };
  });
}, 'file:///' + b);
await page.waitForTimeout(800);
const info = await page.evaluate(() => window.__diff);
console.log('diff bbox:', JSON.stringify(info), 'changed px:', info.count);
await page.screenshot({ path: path.resolve('regression-shots/diff-k1-k2.png') });
await browser.close();
