// 照片墙预览（PhotoViewer）核查：
// ① 关闭按钮是否在可见区、点得到（刘海屏下不再压在状态栏/挖孔区）
// ② 未缩放(scale=1)时单指拖动图片：图片固定不动（不平移）
// ③ 放大后(scale>1)单指拖动：可平移查看
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const stub = () => {
  const pngUrl = (n) => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${(n * 37) % 360} 70% 55%)`;
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('IMG' + n, 40, 80);
    return c.toDataURL('image/png');
  };
  const photos = [];
  for (let i = 1; i <= 31; i++) {
    photos.push({ id: i, bucket: '淳安县', name: `照片${i}.jpg`, path: `/DCIM/${i}.jpg`, uri: `content://${i}`, mtime: 1700000000000 + i * 1000, width: 1200, height: 900, mime: 'image/jpeg' });
  }
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd) => {
      if (cmd === 'media_permission_state' || cmd === 'media_request_permission') return true;
      if (cmd === 'media_list_albums') return [{ name: '淳安县', count: 31 }];
      if (cmd === 'media_all_photos' || cmd === 'media_album_photos') return photos;
      if (cmd === 'plugin:app|registerListener') return 0;
      throw new Error('unstubbed ' + cmd);
    },
    convertFileSrc: (p) => pngUrl(0),
  };
};

const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA_ANDROID });
await page.addInitScript(stub);
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }));
await page.waitForSelector('.wall-gallery', { timeout: 8000 });
await page.waitForTimeout(2000);
await page.click('.wall-gallery .wall-tile:first-child');
await page.waitForSelector('.pv-close', { timeout: 8000 });
await page.waitForTimeout(500);

// ① 关闭按钮位置
const closePos = await page.evaluate(() => {
  const b = document.querySelector('.pv-close').getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) };
});
rec('预览关闭按钮在可见区(可点)', closePos.top >= 0 && closePos.top < 120, `top=${closePos.top} bottom=${closePos.bottom}`);

const parseT = (s) => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(s || '');
  const sm = /scale\(([-\d.]+)\)/.exec(s || '');
  return { tx: m ? parseFloat(m[1]) : 0, ty: m ? parseFloat(m[2]) : 0, scale: sm ? parseFloat(sm[1]) : 1 };
};
const getT = () => page.evaluate(() => {
  const el = document.querySelector('.pv-media');
  return el ? el.style.transform : '';
});

// ② scale=1 时单指拖动：图片应固定不动
const tBefore = parseT(await getT());
const box = await page.evaluate(() => {
  const c = document.querySelector('.pv-canvas').getBoundingClientRect();
  return { cx: Math.round(c.left + c.width / 2), cy: Math.round(c.top + c.height / 2) };
});
await page.mouse.move(box.cx, box.cy);
await page.mouse.down();
await page.mouse.move(box.cx - 80, box.cy + 60, { steps: 6 });
await page.mouse.move(box.cx - 140, box.cy + 90, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const tAfterDrag1 = parseT(await getT());
rec('未缩放时单指拖动图片不动(translate 仍为 0)', tAfterDrag1.tx === 0 && tAfterDrag1.ty === 0, `before=${JSON.stringify(tBefore)} after=${JSON.stringify(tAfterDrag1)}`);

// ③ 放大后单指拖动：允许平移
await page.click('button[title="放大（＋）"]');
await page.waitForTimeout(150);
const tZoomed = parseT(await getT());
await page.mouse.move(box.cx, box.cy);
await page.mouse.down();
await page.mouse.move(box.cx - 90, box.cy + 70, { steps: 6 });
await page.mouse.move(box.cx - 150, box.cy + 110, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const tAfterDrag2 = parseT(await getT());
rec('放大后单指拖动可平移(scale>1 且 translate 变化)', tZoomed.scale > 1.001 && (tAfterDrag2.tx !== 0 || tAfterDrag2.ty !== 0), `scale=${tZoomed.scale} before=${JSON.stringify(tZoomed)} after=${JSON.stringify(tAfterDrag2)}`);

await page.screenshot({ path: 'regression-shots/pv-close-mobile.png' });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
