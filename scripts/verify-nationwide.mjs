/**
 * 全国化 + 基线内容回归：
 * ① 加载无报错 ② 左索引列出全部省份（369 市）③ 无「江浙沪皖」残留
 * ④ 首屏按江浙沪皖老家视图取景 ⑤ 外地城市（广州）可下钻出区县基线内容
 * ⑥ 北京（人工精写）仍是完整内容
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

// 公司代理会拦截 localhost，关掉它让浏览器直连
for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const URL = 'http://[::1]:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const W = 1440, H = 900;

let pass = 0, fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.index-group-title', { timeout: 30000 });
await page.waitForTimeout(3500);

const title = (await page.textContent('.index-title'))?.trim() ?? '';
rec('左索引标题含「区域索引」与城市数', /区域索引/.test(title) && /\d+\s*市/.test(title), `"${title}"`);

const provinces = (await page.$$eval('.index-group-title', (els) => els.map((e) => e.textContent.replace(/\d+\s*市/, '').trim()))) ?? [];
rec('左索引覆盖 33 个省级单元', provinces.length === 33, `${provinces.length} 个`);

const bodyText = (await page.textContent('body')) ?? '';
rec('页面无「江浙沪皖」文案残留', !bodyText.includes('江浙沪皖'), '已清除');

const metaTexts = (await page.$$eval('.index-row .index-meta', (els) => els.map((e) => e.textContent.trim()))) ?? [];
const pending = metaTexts.filter((t) => t === '待录入').length;
// 34 个「无下级区县」的县级市（海南县级市 / 嘉峪关 / 兵团市 / 台湾）仍待录入
rec('待录入只剩无下级区县的那批', pending > 0 && pending < 60, `${pending} 个待录入 / 共 ${metaTexts.length} 市`);

/* ④ 首屏取景 = 江浙沪皖 */
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('.geo-label')].map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.textContent.trim(), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  }),
);
const onScreen = (n) => {
  const l = labels.find((x) => x.name === n);
  return Boolean(l && l.cx > 0 && l.cx < W && l.cy > 0 && l.cy < H);
};
rec('首屏取景在江浙沪皖（四省标签都在屏内）',
  ['江苏省', '浙江省', '安徽省', '上海市'].every(onScreen),
  ['江苏省', '浙江省', '安徽省', '上海市'].map((n) => `${n}:${onScreen(n) ? '✓' : '✗'}`).join(' '));
rec('远省份不在首屏内（说明是四省视角）', !onScreen('北京市') && !onScreen('广东省'),
  `北京:${onScreen('北京市') ? '在屏' : '屏外'} 广东:${onScreen('广东省') ? '在屏' : '屏外'}`);

await page.screenshot({ path: path.join(OUT, 'nw-overview.png') });

/* ⑤ 外地城市（广州）下钻出区县基线内容 */
await page.evaluate(() => window.__sandboxApp.focusCityById('440100'));
await page.waitForTimeout(3200);
const gzRows = await page.$$('.index-row--district');
const gzMetas = (await page.$$eval('.index-row--district .index-meta', (els) => els.map((e) => e.textContent.trim()))) ?? [];
const gzEmpty = await page.$$('.index-row--district.is-empty');
rec('广州下钻后有区县列表', gzRows.length > 5, `${gzRows.length} 个区县`);
rec('广州区县不再是「未录入」', gzEmpty.length === 0, `is-empty ${gzEmpty.length} 个 · ${gzMetas.slice(0, 4).join(' / ')}`);
await page.screenshot({ path: path.join(OUT, 'nw-guangzhou.png') });

/* ⑥ 北京（人工精写）仍是完整内容 */
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(2200);
await page.evaluate(() => window.__sandboxApp.focusCityById('110000'));
await page.waitForTimeout(2800);
const bjRows = await page.$$('.index-row--district');
const bjSpots = (await page.$$eval('.index-row--district:not(.is-empty) .index-meta', (els) => els.map((e) => e.textContent.trim()))) ?? [];
rec('北京下钻仍是 16 区县且有景点', bjRows.length === 16 && bjSpots.filter((t) => /景点/.test(t)).length > 0,
  `${bjRows.length} 区县 · ${bjSpots.filter((t) => /景点/.test(t)).length} 个有景点`);

rec('全程无 JS 运行时错误', errors.length === 0, errors.length ? errors.slice(0, 2).join(' | ') : '无');

await browser.close();
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
