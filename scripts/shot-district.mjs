/** 下钻验证：点击杭州后地形与贴地边界线应一起隐藏，区县板块正常可交互 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(9000);

// 杭州大致位置（浙江省北部）
await page.mouse.click(505, 415);
await page.waitForTimeout(3200);
await page.screenshot({ path: `${OUT}/terrain-district.png` });

console.log('截图完成', errors.length ? `错误：${errors[0]}` : '无页面异常');
await browser.close();
