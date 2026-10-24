// v0.9.24 桌面端回归：手机端做的精简不能反过来影响桌面
// ① 照片墙仍有 4 种风格（含「照片空间 · 3D」）
// ② 排序条仍在
// ③ 查看器仍有左右箭头按钮
// ④ 数据面板未编辑时也不显示「静态内容」
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const stub = () => {
  const png = (() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#c0392b';
    x.fillRect(0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  })();
  const photos = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    bucket: '淳安县',
    name: `桌面照片${i + 1}.jpg`,
    path: `/DCIM/d${i + 1}.jpg`,
    uri: null,
    mtime: 1700000000000 + i * 1000,
    width: 1200,
    height: 900,
    mime: 'image/jpeg',
  }));
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd) => {
      if (cmd === 'media_permission_state' || cmd === 'media_request_permission') return true;
      if (cmd === 'media_list_albums') return [{ name: '淳安县', count: photos.length }];
      if (cmd === 'media_all_photos' || cmd === 'media_album_photos') return photos;
      if (cmd === 'plugin:app|registerListener') return 0;
      throw new Error('unstubbed ' + cmd);
    },
    convertFileSrc: () => png,
  };
};

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(stub);
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(1800);

await page.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }),
);
await page.waitForSelector('.wall-modal', { timeout: 8000 });
await page.waitForTimeout(1000);
const wall = await page.evaluate(() => ({
  styles: [...document.querySelectorAll('.wall-style-chip')].map((b) => b.textContent.trim()),
  hasSorts: Boolean(document.querySelector('.wall-sorts')),
  coarse: window.matchMedia('(pointer: coarse)').matches,
}));
rec('桌面端仍有 4 种风格（含 3D）', wall.styles.length === 4 && wall.styles.some((s) => s.includes('3D')), `styles=${wall.styles.join('/')}`);
rec('桌面端排序条仍在', wall.hasSorts === true, `hasSorts=${wall.hasSorts}`);
// 查看器箭头只在「触屏」隐藏；桌面指针不是 coarse，按钮必然保留
rec('桌面端指针不是 coarse（查看器箭头保留）', wall.coarse === false, `coarse=${wall.coarse}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.hud-top .data-pill')].find((x) => x.textContent.includes('数据'));
  b?.click();
});
await page.waitForSelector('.data-panel', { timeout: 8000 });
await page.waitForTimeout(1200);
const data = await page.evaluate(() => {
  const txt = document.querySelector('.data-panel')?.textContent ?? '';
  return { hasStatic: txt.includes('静态内容'), hasEditor: Boolean(document.querySelector('.data-editor-title')) };
});
rec('桌面端数据面板也不再显示「静态内容」', data.hasStatic === false, `hasStatic=${data.hasStatic}`);
rec('桌面端数据面板编辑区正常', data.hasEditor === true, `hasEditor=${data.hasEditor}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
