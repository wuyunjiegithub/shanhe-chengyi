// 轻量回归：启动真实 Chrome，跑通「浏览 + 数据编辑」核心链路，收集运行时错误并截图。
// 用法：node scripts/regression-browse.mjs   （需 vite 已起在 1421）
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.URL || 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

const log = (s) => console.log(s);
const shot = (n) => page.screenshot({ path: path.join(OUT, n) });

try {
  log('▶ 加载应用');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.hud-top', { timeout: 15000 });

  // --- 先做「无本地编辑」的干净浏览回归 ---
  log('▶ 清空本地覆盖层并重载（干净浏览）');
  await page.evaluate(() => localStorage.removeItem('ds.contentEdits.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hud-top', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await shot('01-region.png');
  log('  ✓ 区域总览已渲染（无编辑）');

  log('▶ 下钻进入已录入城市');
  await page.waitForSelector('.index-row:not(.is-empty)', { timeout: 10000 });
  await page.locator('.index-row:not(.is-empty)').first().click();
  await page.waitForSelector('.city-hot-chip', { timeout: 10000 });
  await page.waitForTimeout(600);
  await shot('02-city.png');
  log('  ✓ 城市概览卡已渲染（含热门区县胶囊）');

  log('▶ 打开区县详情抽屉');
  await page.locator('.city-hot-chip').first().click();
  await page.waitForSelector('.drawer-inner', { timeout: 10000 });
  await page.waitForTimeout(600);
  await shot('03-drawer.png');
  const drawerTitle = await page.locator('.drawer-title').first().textContent().catch(() => '');
  log(`  ✓ 区县抽屉已打开：${(drawerTitle || '').trim().slice(0, 20)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // --- 数据面板：编辑 → 保存 ---
  log('▶ 打开数据面板');
  await page.click('.data-pill:not(.data-pill--photo)', { timeout: 10000 });
  await page.waitForSelector('.data-panel', { timeout: 10000 });
  await page.waitForSelector('.data-main .input', { timeout: 10000 });
  const saveBefore = await page.locator('.data-save').isDisabled();
  await shot('04-datapanel.png');
  log(`  ✓ 面板打开，初始保存按钮禁用=${saveBefore}（应为 true）`);

  log('▶ 编辑名称字段（制造脏状态）');
  const input = page.locator('.data-main .input').first();
  const orig = await input.inputValue();
  await input.fill(orig + '·回归');
  await page.waitForTimeout(300);
  const saveDirty = await page.locator('.data-save').isDisabled();
  log(`  ✓ 改动后保存按钮禁用=${saveDirty}（应为 false）`);
  await shot('05-dirty.png');

  log('▶ 保存');
  await page.click('.data-save', { timeout: 10000 });
  await page.waitForTimeout(800);
  const editsLen = await page.evaluate(() => (localStorage.getItem('ds.contentEdits.v1') || '').length);
  const saveAfter = await page.locator('.data-save').isDisabled();
  log(`  ✓ 保存后 localStorage 覆盖层字节数=${editsLen}（应>0）；保存按钮禁用=${saveAfter}（应为 true）`);
  await shot('06-saved.png');

  log('▶ Esc 关闭面板');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const panelGone = (await page.locator('.data-panel').count()) === 0;
  log(`  ✓ 面板已关闭=${panelGone}（应为 true）`);

  // 清理：移除回归期间写入的编辑
  await page.evaluate(() => localStorage.removeItem('ds.contentEdits.v1'));
  log('  ✓ 已清理回归写入手动编辑，退出不留痕迹');

  // --- 校验结果 ---
  await browser.close();
  const totalErrors = consoleErrors.length + pageErrors.length;
  log('\n=== 回归结果 ===');
  log(`控制台错误：${consoleErrors.length}　页面异常：${pageErrors.length}`);
  consoleErrors.slice(0, 10).forEach((e) => log('  console.error: ' + e.slice(0, 160)));
  pageErrors.slice(0, 10).forEach((e) => log('  pageerror: ' + e.slice(0, 160)));
  log(`截图目录：${OUT}`);
  log(totalErrors === 0 ? '\n✅ 通过：核心链路无运行时错误' : '\n❌ 存在运行时错误');
  process.exit(totalErrors === 0 ? 0 : 1);
} catch (err) {
  await shot('error.png').catch(() => {});
  log('❌ 回归中断：' + (err && err.message ? err.message : err));
  if (pageErrors.length) pageErrors.forEach((e) => log('  pageerror: ' + e.slice(0, 200)));
  await browser.close();
  process.exit(2);
}
