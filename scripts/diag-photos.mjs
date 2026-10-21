import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

/* ---------- 生成测试图片（最小 PNG 编码器） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < w; x++) {
      const o = rowStart + 1 + x * 3;
      // 简单渐变，便于肉眼/像素确认
      raw[o] = Math.min(255, r + (x * 60) / w);
      raw[o + 1] = g;
      raw[o + 2] = Math.min(255, b + (y * 60) / h);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ROOT = path.resolve('regression-shots/photo-fixture/浙江省/杭州市/淳安县');
fs.mkdirSync(ROOT, { recursive: true });
const files = [
  ['qiandao-1.png', 1200, 800, [30, 90, 160]],
  ['qiandao-2.png', 900, 1600, [160, 60, 40]],
  ['qiandao-3.png', 1600, 900, [40, 140, 90]],
];
for (const [name, w, h, rgb] of files) {
  fs.writeFileSync(path.join(ROOT, name), makePng(w, h, rgb));
}
console.log('fixture:', ROOT, files.map((f) => f[0]).join(', '));

/* ---------- 绑定并验证 ---------- */
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// 无头 Chrome 支持 showDirectoryPicker（原生弹窗没法驱动），这里关掉它走 <input> 退化路径
await page.addInitScript(() => {
  try {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  } catch { /* ignore */ }
});
await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);

// 打开设置 → 用「选择文件夹」退化路径绑定
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.hud-top button')].find((x) => x.textContent.includes('设置'));
  b && b.click();
});
await page.waitForTimeout(500);
const input = await page.$('input[type=file]');
if (!input) throw new Error('未找到文件夹选择 input');
// 直接塞 FileList：Playwright 的 setInputFiles 不会带 webkitRelativePath，
// 而扫描正是靠它还原「浙江省/杭州市/淳安县」层级
const payload = files.map(([name]) => ({
  name,
  rel: `浙江省/杭州市/淳安县/${name}`,
  b64: fs.readFileSync(path.join(ROOT, name)).toString('base64'),
}));
await page.evaluate((items) => {
  const dt = new DataTransfer();
  for (const it of items) {
    const bin = Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0));
    const f = new File([bin], it.name, { type: 'image/png' });
    Object.defineProperty(f, 'webkitRelativePath', { value: it.rel, configurable: true });
    dt.items.add(f);
  }
  const el = document.querySelector('input[type=file]');
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, payload);
await page.waitForTimeout(1500);
const bindText = await page.evaluate(() => document.querySelector('.settings-panel')?.textContent?.slice(0, 400) ?? '');
console.log('绑定状态文案:', bindText.replace(/\s+/g, ' ').slice(0, 260));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

async function openWall() {
  await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
  await page.waitForTimeout(2600);
  await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.includes('照片墙'));
    b && b.click();
  });
  await page.waitForTimeout(1600);
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.wall-modal img')];
    return {
      tiles: document.querySelectorAll('.wall-tile').length,
      imgCount: imgs.length,
      loaded: imgs.filter((i) => i.naturalWidth > 0).length,
      sizes: imgs.slice(0, 4).map((i) => `${i.naturalWidth}x${i.naturalHeight}→${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`),
      empty: !!document.querySelector('.wall-empty'),
    };
  });
}

console.log('绑定后照片墙:', JSON.stringify(await openWall()));

// 放大（聚焦）态：应完整显示（宽高比与原始一致）
await page.evaluate(() => document.querySelector('.wall-tile')?.click());
await page.waitForTimeout(1200);
const focused = await page.evaluate(() => {
  const img = document.querySelector('.wall-focus-img img');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  const cs = getComputedStyle(img);
  return {
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    shown: `${Math.round(r.width)}x${Math.round(r.height)}`,
    naturalRatio: +(img.naturalWidth / img.naturalHeight).toFixed(3),
    shownRatio: +(r.width / r.height).toFixed(3),
    objectFit: cs.objectFit,
    withinViewport: r.width <= window.innerWidth + 1 && r.height <= window.innerHeight + 1,
  };
});
console.log('放大态:', JSON.stringify(focused));

// 刷新后是否还在（IndexedDB 字节缓存）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2800);
console.log('刷新后照片墙:', JSON.stringify(await openWall()));
console.log('ERRORS', JSON.stringify(errors.slice(0, 3)));
await browser.close();
