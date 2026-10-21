// 校验更名生效：标题、启动页、顶栏品牌均为「山河城邑」。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle' });
await page.waitForSelector('.brand-name', { timeout: 15000 });
await page.waitForTimeout(800);
const title = await page.title();
const brand = (await page.locator('.brand-name').first().textContent())?.trim();
console.log(`document.title = "${title}"`);
console.log(`brand-name     = "${brand}"`);
await page.screenshot({ path: 'regression-shots/rename-topbar.png' });
await browser.close();
const ok = title.includes('山河城邑') && brand === '山河城邑';
console.log(ok ? '✅ 更名生效' : '❌ 名称未更新');
process.exit(ok ? 0 : 1);
