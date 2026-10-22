/** 用户手册配图：PC 端各界面 + 手机端关键界面，统一命名 doc-*.png */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://127.0.0.1:1422/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

const browser = await chromium.launch({ executablePath: CHROME });

/* ============ PC 端（1440x900） ============ */
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pc pageerror]', String(e).slice(0, 120)));
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(7000);

/* 1. 总览 */
await pc.screenshot({ path: path.join(OUT, 'doc-pc-home.png') });

/* 2. 城市面板（杭州） */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2200);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-city.png') });

/* 3. 区县详情（西湖区） */
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await pc.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await pc.waitForTimeout(1600);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-district.png') });

/* 4. 照片墙（展厅样式） */
await pc.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'city', id: '330100', title: '杭州 · 照片墙' }),
);
await pc.waitForTimeout(2200);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-wall.png') });

/* 5. 3D 照片空间（星系） */
await pc.evaluate(() => {
  const chip = [...document.querySelectorAll('.wall-style-chip')].find((b) =>
    b.textContent.includes('3D'),
  );
  chip?.click();
});
await pc.waitForTimeout(3500);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-hall.png') });
await pc.keyboard.press('Escape');
await pc.waitForTimeout(600);

/* 6. 游记面板 */
await pc.evaluate(() => window.__sandboxApp.backToRegion());
await pc.waitForTimeout(800);
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.bottom-right .ghost-pill')].find((b) =>
    b.textContent.includes('游记'),
  );
  btn?.click();
});
await pc.waitForTimeout(1500);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-travel.png') });
await pc.keyboard.press('Escape');
await pc.waitForTimeout(500);

/* 7. 时间线 */
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.bottom-right .ghost-pill')].find((b) =>
    b.textContent.includes('时间线'),
  );
  btn?.click();
});
await pc.waitForTimeout(1500);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-timeline.png') });
await pc.keyboard.press('Escape');
await pc.waitForTimeout(500);

/* 8. 数据面板 */
await pc.evaluate(() => {
  const btn = [...document.querySelectorAll('.top-right .data-pill')].find((b) =>
    b.textContent.includes('数据'),
  );
  btn?.click();
});
await pc.waitForTimeout(1500);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-data.png') });
await pc.keyboard.press('Escape');
await pc.waitForTimeout(500);

/* 9. 搜索 */
await pc.click('.search-field input');
await pc.type('.search-field input', '西湖', { delay: 60 });
await pc.waitForTimeout(1200);
await pc.screenshot({ path: path.join(OUT, 'doc-pc-search.png') });
await pc.keyboard.press('Escape');

await pc.close();

/* ============ 手机端（390x844） ============ */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
m.on('pageerror', (e) => console.log('[m pageerror]', String(e).slice(0, 120)));
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForTimeout(6000);
await m.screenshot({ path: path.join(OUT, 'doc-m-home.png') });

/* 手机端：城市面板半屏 */
await m.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await m.waitForTimeout(2200);
await m.screenshot({ path: path.join(OUT, 'doc-m-city.png') });

/* 手机端：区县详情半屏 */
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 }).catch(() => null);
await m.waitForTimeout(1600);
await m.screenshot({ path: path.join(OUT, 'doc-m-district.png') });

await browser.close();
console.log('手册截图完成：doc-pc-*.png / doc-m-*.png');
