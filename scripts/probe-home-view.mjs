import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) delete process.env[k];

const URL = 'http://[::1]:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const W = 1440, H = 900;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.index-group-title', { timeout: 30000 });
await page.waitForTimeout(3500);

const frame = await page.evaluate(() => window.__sandboxApp.lastFrame());
const ext = await page.evaluate(() => window.__sandboxApp.screenExtent());
const usable = { w: W - 234 - 18, h: H - 70 - 64 };
const ew = ext.x1 - ext.x0, eh = ext.y1 - ext.y0;
console.log('首屏 lastFrame:', JSON.stringify(frame));
console.log(`地图占可用区: 宽 ${(ew / usable.w).toFixed(2)} 高 ${(eh / usable.h).toFixed(2)}  dist=${frame.dist.toFixed(1)}`);

const labels = await page.evaluate(() =>
  [...document.querySelectorAll('.geo-label')].map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.textContent.trim(), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  }),
);
const on = (n) => {
  const l = labels.find((x) => x.name === n);
  return l ? `${l.cx},${l.cy}${l.cx > 0 && l.cx < W && l.cy > 0 && l.cy < H ? ' ✓在屏内' : ' ✗屏外'}` : '无此标签';
};
console.log('江浙沪皖:');
for (const n of ['江苏省', '浙江省', '安徽省', '上海市']) console.log(`  ${n}: ${on(n)}`);
console.log('远省份（应为屏外）:');
for (const n of ['北京市', '广东省', '四川省', '福建省']) console.log(`  ${n}: ${on(n)}`);

await page.screenshot({ path: path.join(OUT, 'home-view-desktop.png') });
await browser.close();
