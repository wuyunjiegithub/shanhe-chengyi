// 手机端三条核查：
// ① 「去过标记」样式（小旗子 / 图钉 / 打卡章 / 脚印）在手机上改得到，且刷新后保持
// ② 地形 / 天气图层开关持久化，重开 App 还是上次的设置
// ③ 数据面板里不再有「移除该区县内容」按钮
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await pw.chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));

const boot = async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hud-top', { timeout: 20000 });
  await page.waitForTimeout(2200);
};

await boot();

/* ---------- ① 去过标记样式在手机上可改 ---------- */
await page.click('.hud-bottom .fav-pill');
await page.waitForSelector('.fav-panel', { timeout: 8000 });
await page.waitForTimeout(600);

const picker = await page.evaluate(() => {
  const box = document.querySelector('.fav-panel .marker-style--compact');
  if (!box) return null;
  const opts = [...box.querySelectorAll('.marker-style-opt')].map((b) => ({
    label: b.querySelector('b')?.textContent.trim() ?? '',
    on: b.classList.contains('is-on'),
    w: Math.round(b.getBoundingClientRect().width),
  }));
  return { opts };
});
rec(
  '手机上能看见「去过标记」样式选择器',
  Boolean(picker) && picker.opts.length === 4,
  picker ? `options=${JSON.stringify(picker.opts.map((o) => o.label))}` : '找不到 .marker-style--compact',
);
rec(
  '四个选项都在可点宽度内(未挤成 0 宽)',
  Boolean(picker) && picker.opts.every((o) => o.w > 30),
  picker ? `widths=${JSON.stringify(picker.opts.map((o) => o.w))}` : '',
);
rec(
  '默认选中「小旗子」',
  Boolean(picker) && picker.opts.find((o) => o.on)?.label === '小旗子',
  picker ? `active=${picker.opts.find((o) => o.on)?.label}` : '',
);

// 切到「图钉」
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.fav-panel .marker-style-opt')].find(
    (b) => b.querySelector('b')?.textContent.trim() === '图钉',
  );
  btn?.click();
});
await page.waitForTimeout(400);
const picked = await page.evaluate(() => ({
  stored: localStorage.getItem('ds.markerStyle.v1'),
  active:
    [...document.querySelectorAll('.fav-panel .marker-style-opt')]
      .find((b) => b.classList.contains('is-on'))
      ?.querySelector('b')?.textContent.trim() ?? '',
}));
rec('点「图钉」立刻生效并写入本地', picked.stored === 'pin' && picked.active === '图钉', JSON.stringify(picked));
await page.screenshot({ path: 'regression-shots/mobile-marker-style.png' });

/* ---------- ② 地形开关持久化 ---------- */
const terrainBefore = await page.evaluate(() => ({
  on: document.querySelector('.data-pill--terrain')?.classList.contains('is-on'),
}));
rec('地形默认开启', terrainBefore.on === true, `is-on=${terrainBefore.on}`);

// 关掉地形（面板还开着，先关掉再点顶栏）
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('.hud-top .data-pill--terrain');
await page.waitForTimeout(500);
const layerStored = await page.evaluate(() => localStorage.getItem('ds.layers.v1'));
rec('切换地形后写入 ds.layers.v1', Boolean(layerStored) && JSON.parse(layerStored).terrain === false, `stored=${layerStored}`);

// 刷新页面，看是否保持
await boot();
const afterReload = await page.evaluate(() => ({
  pillOn: document.querySelector('.data-pill--terrain')?.classList.contains('is-on'),
  stored: localStorage.getItem('ds.layers.v1'),
  marker: localStorage.getItem('ds.markerStyle.v1'),
}));
rec('重开 App 后地形仍是关闭状态', afterReload.pillOn === false, `pillOn=${afterReload.pillOn} stored=${afterReload.stored}`);
rec('重开 App 后标记样式仍是「图钉」', afterReload.marker === 'pin', `marker=${afterReload.marker}`);

// 再把地形打开，确认双向都持久化
await page.click('.hud-top .data-pill--terrain');
await page.waitForTimeout(400);
const backOn = await page.evaluate(() => localStorage.getItem('ds.layers.v1'));
rec('再把地形打开也写回 true', JSON.parse(backOn).terrain === true, `stored=${backOn}`);

/* ---------- ③ 数据面板去掉「移除该区县内容」 ---------- */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.hud-top .data-pill')].find((b) =>
    b.textContent.includes('数据'),
  );
  btn?.click();
});
await page.waitForSelector('.data-panel', { timeout: 8000 });
await page.waitForTimeout(1200);
const dataPanel = await page.evaluate(() => {
  const txt = document.querySelector('.data-panel')?.textContent ?? '';
  return {
    hasRemove: txt.includes('移除该区县内容'),
    hasEditor: Boolean(document.querySelector('.data-editor-title')),
  };
});
rec('数据面板已无「移除该区县内容」按钮', dataPanel.hasRemove === false, `hasRemove=${dataPanel.hasRemove}`);
rec('数据面板其余功能仍在(编辑器正常加载)', dataPanel.hasEditor === true, `hasEditor=${dataPanel.hasEditor}`);
await page.screenshot({ path: 'regression-shots/mobile-data-panel.png' });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
