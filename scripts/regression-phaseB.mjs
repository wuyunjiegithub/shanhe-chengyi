// 阶段 B 回归：五角星收藏标记 / 地图无线 / 游记图文 / 时间线
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

// 生成一张小测试图（供相册上传）
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvg0hAAABh8H8TwAAAABJRU5ErkJggg==';
const IMG = path.join(OUT, 'sample-note.png');
fs.writeFileSync(IMG, Buffer.from(PNG_B64, 'base64'));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2000);

// ---- 0. 全国视图底部截图（查网格溢出线）----
await page.screenshot({ path: path.join(OUT, 'b0-national.png') });
const box = await page.evaluate(() => {
  const c = window.__sandboxScene.container;
  return { w: c.clientWidth, h: c.clientHeight };
});
await page.screenshot({ path: path.join(OUT, 'b0-bottom.png'), clip: { x: 0, y: Math.max(0, box.h - 150), width: box.w, height: 150 } });

// ---- 1. 进入上海市，选一个区县 ----
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2200);

const dhit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 140; i++) {
    for (let j = 0; j < 90; j++) {
      const nx = (i / 139) * 2 - 1, ny = 1 - (j / 89) * 2;
      const h = scene.pick(nx, ny);
      if (h && h.object.userData.kind === 'district') {
        return { id: h.object.userData.id, x: Math.round(rect.left + ((nx + 1) / 2) * rect.width), y: Math.round(rect.top + ((1 - ny) / 2) * rect.height) };
      }
    }
  }
  return null;
});
console.log('1) district hit:', JSON.stringify(dhit));
if (!dhit) { console.log('NO DISTRICT HIT'); await browser.close(); process.exit(1); }
// 用确定性 API 打开抽屉（避免点到景点光柱弹出 leaf 遮罩）
await page.evaluate((id) => window.__sandboxApp.selectDistrictById(id), dhit.id);
await page.waitForTimeout(1500);

// 选中后查：未选中区县应全部 targetY=0（无地势差）；选中区县仅做统一高亮抬升
const liftInfo = await page.evaluate((id) => {
  const scene = window.__sandboxScene;
  let maxOther = 0;
  for (const [oid, rec] of scene.districts) {
    if (oid === id) continue;
    maxOther = Math.max(maxOther, Math.abs(rec.targetY));
  }
  const sel = scene.districts.get(id);
  return { selectedTargetY: Math.round(sel.targetY * 100) / 100, maxOtherTargetY: Math.round(maxOther * 100) / 100, drawerOpen: !!document.querySelector('.drawer.is-open') };
}, dhit.id);
console.log('   lift:', JSON.stringify(liftInfo), liftInfo.maxOtherTargetY === 0 && liftInfo.drawerOpen ? 'PASS 无地势差+抽屉开' : 'CHECK');

// ---- 2. 收藏（五角星）----
await page.locator('.drawer-head-actions .icon-btn').first().click();
await page.waitForTimeout(500);
const star = await page.evaluate(() => {
  const btn = document.querySelector('.drawer-head-actions .icon-btn');
  const mark = btn?.querySelector('.want-mark');
  const starEl = mark?.querySelector('.want-mark__star');
  return {
    isOn: btn?.className?.includes('is-on'),
    hasStar: !!starEl,
    starFill: starEl ? getComputedStyle(starEl).fill : null,
  };
});
console.log('2) fav star:', JSON.stringify(star), star.hasStar ? 'PASS 五角星' : 'FAIL');
await page.screenshot({ path: path.join(OUT, 'b2-fav-star.png') });

// ---- 3. 写过过标记（同时产生一条到访记录）----
await page.locator('.drawer-head-actions .icon-btn--visited').click();
await page.waitForTimeout(400);
const visOn = await page.evaluate(() => document.querySelector('.drawer-head-actions .icon-btn--visited')?.className?.includes('is-on'));
console.log('3) visited toggled:', visOn, visOn ? 'PASS' : 'FAIL');

// ---- 4. 写游记（图文）----
await page.locator('.drawer-actions .ghost-btn', { hasText: '写游记' }).click();
await page.waitForTimeout(800);
const travelOpen = await page.evaluate(() => !!document.querySelector('.travel-panel .note-editor'));
console.log('4) travel editor open:', travelOpen, travelOpen ? 'PASS' : 'FAIL');
if (travelOpen) {
  await page.fill('.note-title-input', '黄浦江畔的傍晚');
  await page.click('.rt-body');
await page.keyboard.type('今天沿着外滩走了很久，江水、灯光、轮渡，都很温柔。');
  const prefill = await page.evaluate(() => document.querySelector('.note-place-chip')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  console.log('   prefill place:', JSON.stringify(prefill));
  const fileInput = page.locator('.note-images input[type=file]');
  if (await fileInput.count()) {
    await fileInput.setInputFiles(IMG);
    await page.waitForTimeout(4000);
    const thumbs = await page.evaluate(() => document.querySelectorAll('.note-image-grid li img').length);
    console.log('   image thumbs after upload:', thumbs, thumbs > 0 ? 'PASS 图文' : 'FAIL');
  }
  await page.screenshot({ path: path.join(OUT, 'b4-travel-edit.png') });
  await page.locator('.note-editor-head .primary-btn').click(); // 保存
  await page.waitForTimeout(800);
  const noteCount = await page.evaluate(() => document.querySelectorAll('.travel-panel .note-card').length);
  console.log('   travel notes after save:', noteCount, noteCount > 0 ? 'PASS 已保存' : 'FAIL');
  await page.screenshot({ path: path.join(OUT, 'b4-travel-list.png') });
  // 关闭游记面板
  await page.locator('.travel-panel .fav-head .icon-btn').click();
  await page.waitForTimeout(400);
}

// ---- 5. 时间线 ----
await page.locator('.bottom-right button', { hasText: '时间线' }).first().click();
await page.waitForTimeout(800);
const tlState = await page.evaluate(() => {
  const panel = document.querySelector('.timeline-panel');
  return {
    open: !!panel,
    places: document.querySelectorAll('.timeline-panel .fav-item').length,
    records: document.querySelectorAll('.timeline-panel .timeline-record').length,
    sample: document.querySelector('.timeline-panel .fav-item-sub')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
});
console.log('5) timeline:', JSON.stringify(tlState), tlState.open && tlState.records > 0 ? 'PASS' : 'CHECK');
await page.screenshot({ path: path.join(OUT, 'b5-timeline.png') });

console.log('\nERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
await browser.close();
console.log('regression done');
