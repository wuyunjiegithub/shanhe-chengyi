// 验证：上海市可下钻，且此前 8 个未录入区县现已可打开抽屉（不再 未录入）。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

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

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hud-top');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hud-top');
  await page.waitForTimeout(800);

  log('▶ 进入上海市（区域总览点击上海行）');
  await page.locator('.index-row', { hasText: '上海市' }).first().click();
  await page.waitForSelector('.index-row--district', { timeout: 10000 });
  await page.waitForTimeout(500);

  const totalDistricts = await page.locator('.index-row--district').count();
  const emptyCount = await page.locator('.index-row--district.is-empty').count();
  const unenteredText = await page.locator('.index-row--district', { hasText: '未录入' }).count();
  log(`  ✓ 上海区县行数=${totalDistricts}（应 16）　未录入行=${emptyCount}（应 0）　含「未录入」文本=${unenteredText}（应 0）`);
  await page.screenshot({ path: `${OUT}/sh-city.png` });

  log('▶ 打开此前未录入的「长宁区」抽屉');
  await page.locator('.index-row--district', { hasText: '长宁区' }).first().click();
  await page.waitForSelector('.drawer-inner', { timeout: 10000 });
  await page.waitForTimeout(600);
  const title = (await page.locator('.drawer-title').first().textContent())?.trim();
  log(`  ✓ 抽屉标题="${title}"（应含 长宁区）`);
  await page.screenshot({ path: `${OUT}/sh-district.png` });

  log('▶ 再打开「崇明区」确认远郊区县也可打开');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('.index-row--district', { hasText: '崇明区' }).first().click();
  await page.waitForSelector('.drawer-inner', { timeout: 10000 });
  await page.waitForTimeout(500);
  const title2 = (await page.locator('.drawer-title').first().textContent())?.trim();
  log(`  ✓ 抽屉标题="${title2}"（应含 崇明区）`);

  await browser.close();
  const total = consoleErrors.length + pageErrors.length;
  log(`\n=== 上海补全回归 === 控制台错误 ${consoleErrors.length} / 页面异常 ${pageErrors.length}`);
  consoleErrors.slice(0, 8).forEach((e) => log('  console.error: ' + e.slice(0, 160)));
  pageErrors.slice(0, 8).forEach((e) => log('  pageerror: ' + e.slice(0, 160)));
  log(total === 0 ? '✅ 通过' : '❌ 存在运行时错误');
  process.exit(total === 0 ? 0 : 1);
} catch (err) {
  await page.screenshot({ path: `${OUT}/sh-error.png` }).catch(() => {});
  log('❌ 中断：' + (err?.message ?? err));
  await browser.close();
  process.exit(2);
}
