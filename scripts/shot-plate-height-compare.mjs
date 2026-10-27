/**
 * 对比截图：区县挤出高度（DISTRICT_HEIGHT）对近景的影响
 * 同时拍「区县近景」与「城市视图」，确认压薄后城市视图的层次感没坏。
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const TAG = process.env.TAG || 'h1';

const browser = await chromium.launch({ executablePath: CHROME });

/* ---------- 手机：区县近景 ---------- */
{
  const pc = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: UA,
    isMobile: true,
    hasTouch: true,
  });
  pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await pc.goto(URL, { waitUntil: 'networkidle' });
  await pc.waitForTimeout(9000);
  await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
  await pc.waitForTimeout(2600);
  const ids = await pc.evaluate(() => window.__sandboxApp.districtsOf?.('330100') ?? []);
  await pc.evaluate((id) => window.__sandboxApp.selectDistrictById(id), ids[0]);
  await pc.waitForTimeout(3000);

  const SAMPLE = [];
  for (let y = 90; y <= 700; y += 18) for (let x = 30; x <= 360; x += 18) SAMPLE.push([x, y]);
  const stacks = await pc.evaluate(
    (pts) => pts.map(([x, y]) => window.__sandboxApp.pickStack(x, y)),
    SAMPLE,
  );
  let side = 0;
  for (const st of stacks) if (st[0] && st[0].part === 'side') side++;
  console.log(`[${TAG}] 手机侧壁占比 ${((side / SAMPLE.length) * 100).toFixed(1)}%`);
  await pc.screenshot({ path: `scripts/.cache/mobile-closeup-${TAG}.png` });
  await pc.close();
}

/* ---------- 桌面：城市视图（看层次感） ---------- */
{
  const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await pc.goto(URL, { waitUntil: 'networkidle' });
  await pc.waitForTimeout(9000);
  await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
  await pc.waitForTimeout(3000);
  await pc.screenshot({ path: `scripts/.cache/desktop-city-${TAG}.png` });
  await pc.close();
}

await browser.close();
console.log(`截图: mobile-closeup-${TAG}.png / desktop-city-${TAG}.png`);
