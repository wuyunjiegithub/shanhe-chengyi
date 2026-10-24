// v0.9.24 手机端体验核查：
// ① 照片墙不再提供「照片空间 · 3D」风格
// ② 手机端没有排序条
// ③ 查看器里没有 ‹ › 按钮，横向滑动可切换图片
// ④ 长廊舞台图横向滑动可切换，且不出现两侧箭头
// ⑤ 数据面板不再出现「静态内容」标签
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
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${(n * 37) % 360} 70% 55%)`;
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff';
    x.font = '40px sans-serif';
    x.fillText('IMG' + n, 40, 80);
    return c.toDataURL('image/png');
  };
  const photos = [];
  for (let i = 1; i <= 12; i++) {
    photos.push({
      id: i,
      bucket: '淳安县',
      name: `照片${i}.jpg`,
      path: `/DCIM/${i}.jpg`,
      uri: `content://${i}`,
      mtime: 1700000000000 + i * 1000,
      width: 1200,
      height: 900,
      mime: 'image/jpeg',
    });
  }
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd) => {
      if (cmd === 'media_permission_state' || cmd === 'media_request_permission') return true;
      if (cmd === 'media_list_albums') return [{ name: '淳安县', count: photos.length }];
      if (cmd === 'media_all_photos' || cmd === 'media_album_photos') return photos;
      if (cmd === 'plugin:app|registerListener') return 0;
      throw new Error('unstubbed ' + cmd);
    },
    convertFileSrc: (p) => pngUrl(0),
  };
};

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA_ANDROID,
});
await page.addInitScript(stub);
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(1800);

const cdp = await page.context().newCDPSession(page);
/** 真实触摸滑动（Playwright 的 touchscreen 只有 tap，滑动走 CDP） */
async function touchSwipe(from, to, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* ---------- ① ② 照片墙：无 3D、无排序 ---------- */
await page.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }),
);
await page.waitForSelector('.wall-gallery', { timeout: 8000 });
await page.waitForTimeout(1500);
const wall = await page.evaluate(() => ({
  styles: [...document.querySelectorAll('.wall-style-chip')].map((b) => b.textContent.trim()),
  hasSorts: Boolean(document.querySelector('.wall-sorts')),
  tiles: document.querySelectorAll('.wall-gallery .wall-tile').length,
}));
rec('手机端照片墙没有「照片空间 · 3D」', !wall.styles.some((s) => s.includes('3D')), `styles=${wall.styles.join('/')}`);
rec('手机端照片墙没有排序条', wall.hasSorts === false, `hasSorts=${wall.hasSorts} tiles=${wall.tiles}`);

/* ---------- ③ 查看器：无箭头 + 横滑切换 ---------- */
await page.click('.wall-gallery .wall-tile:first-child');
await page.waitForSelector('.pv-close', { timeout: 8000 });
await page.waitForTimeout(500);
const navCount = await page.evaluate(() => document.querySelectorAll('.pv-nav').length);
const counterOf = () =>
  page.evaluate(() => document.querySelector('.pv-meta span')?.textContent?.trim() ?? '');
const c1 = await counterOf();
rec('查看器里没有左右箭头按钮', navCount === 0, `pv-nav=${navCount} counter=${c1}`);

const canvasBox = await page.evaluate(() => {
  const c = document.querySelector('.pv-canvas').getBoundingClientRect();
  return { cx: Math.round(c.left + c.width / 2), cy: Math.round(c.top + c.height / 2) };
});
// 左滑 = 下一张
await touchSwipe({ x: canvasBox.cx + 90, y: canvasBox.cy }, { x: canvasBox.cx - 110, y: canvasBox.cy });
await page.waitForTimeout(600);
const c2 = await counterOf();
rec('查看器左滑切到下一张', c2 !== c1 && c2.startsWith('2'), `${c1} → ${c2}`);

// 右滑 = 上一张
await touchSwipe({ x: canvasBox.cx - 110, y: canvasBox.cy }, { x: canvasBox.cx + 90, y: canvasBox.cy });
await page.waitForTimeout(600);
const c3 = await counterOf();
rec('查看器右滑切回上一张', c3.startsWith('1'), `${c2} → ${c3}`);

await page.screenshot({ path: 'regression-shots/mobile-viewer-swipe.png' });
await page.click('.pv-close');
await page.waitForTimeout(400);

/* ---------- ④ 长廊舞台：横滑切换 + 无箭头 ---------- */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.wall-style-chip')].find((x) => x.textContent.includes('长廊'));
  b?.click();
});
await page.waitForSelector('.wall-stage-main', { timeout: 8000 });
await page.waitForTimeout(800);
const stageNav = await page.evaluate(() => document.querySelectorAll('.wall-nav').length);
const stageIdx = () =>
  page.evaluate(() => document.querySelector('.wall-stage-index')?.textContent?.trim() ?? '');
const s1 = await stageIdx();
const stageBox = await page.evaluate(() => {
  const c = document.querySelector('.wall-stage-img').getBoundingClientRect();
  return { cx: Math.round(c.left + c.width / 2), cy: Math.round(c.top + c.height / 2) };
});
await touchSwipe({ x: stageBox.cx + 80, y: stageBox.cy }, { x: stageBox.cx - 100, y: stageBox.cy });
await page.waitForTimeout(700);
const s2 = await stageIdx();
rec('长廊舞台没有左右箭头', stageNav === 0, `wall-nav=${stageNav}`);
rec('长廊舞台左滑切到下一张', s1 !== s2 && s2.startsWith('2'), `${s1} → ${s2}`);
rec('长廊滑动后没有误开查看器', (await page.locator('.pv-close').count()) === 0, `pv-close=${await page.locator('.pv-close').count()}`);

await page.screenshot({ path: 'regression-shots/mobile-stage-swipe.png' });

/* ---------- ⑤ 数据面板：无「静态内容」 ---------- */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.hud-top .data-pill')].find((x) =>
    x.textContent.includes('数据'),
  );
  b?.click();
});
await page.waitForSelector('.data-panel', { timeout: 8000 });
await page.waitForTimeout(1200);
const data = await page.evaluate(() => {
  const txt = document.querySelector('.data-panel')?.textContent ?? '';
  return {
    hasStatic: txt.includes('静态内容'),
    hasEditor: Boolean(document.querySelector('.data-editor-title')),
    meta: document.querySelector('.data-editor-meta')?.textContent?.trim() ?? '',
  };
});
rec('数据面板不再出现「静态内容」', data.hasStatic === false, `hasStatic=${data.hasStatic} meta="${data.meta}"`);
rec('数据面板编辑器仍正常加载', data.hasEditor === true, `hasEditor=${data.hasEditor}`);
await page.screenshot({ path: 'regression-shots/mobile-data-meta.png' });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
