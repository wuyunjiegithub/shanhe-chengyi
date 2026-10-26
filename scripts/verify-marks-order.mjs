/** 校验：标题前的「喜欢 / 旗子」标记顺序 == 右上角按钮组顺序（都是 心 → 旗） */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(7000);

// 左侧索引：杭州 → 淳安县（HUD 元素被 canvas 覆盖，直接派发 click 绕过命中测试）
const click = async (sel) => {
  const el = page.locator(sel).first();
  await el.dispatchEvent('click');
};
await click('.left-index .index-row:has-text("杭州市")');
await page.waitForTimeout(2000);
await click('.left-index .index-row--district:has-text("淳安县")');
await page.waitForTimeout(2500);

const res = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.place-title-marks svg')].map(
    (s) => s.getAttribute('class') || '',
  );
  const btns = [...document.querySelectorAll('.place-head-actions .icon-btn')].map(
    (b) => b.getAttribute('class') || '',
  );
  return { marks, btns };
});

const markOrder = res.marks.map((c) => (/heart-mark/.test(c) ? 'heart' : 'flag'));
const btnOrder = res.btns
  .filter((c) => /--fav|--visited/.test(c))
  .map((c) => (/--fav/.test(c) ? 'heart' : 'flag'));

const ok = JSON.stringify(markOrder) === JSON.stringify(btnOrder) && markOrder.length === 2;
console.log('标题标记顺序:', markOrder.join(' → '));
console.log('按钮组顺序  :', btnOrder.join(' → '));
console.log(ok ? 'PASS 两组顺序一致' : 'FAIL 顺序不一致');
if (errors.length) console.log('页面异常:', errors[0]);

await page.screenshot({ path: 'regression-shots/marks-order.png' });
await browser.close();
process.exit(ok ? 0 : 1);
