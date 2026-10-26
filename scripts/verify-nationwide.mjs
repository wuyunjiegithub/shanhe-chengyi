/**
 * 全国化回归：① 加载无报错 ② 左索引列出全部省份（369 市）③ 无「江浙沪皖」残留
 *           ④ 北京（已录入）下钻有内容 ⑤ 未录入省份显示「待录入」+ 点击弹提示
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

// 公司代理会拦截 localhost，关掉它让浏览器直连
for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) delete process.env[k];

const URL = 'http://[::1]:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const W = 1440;
const H = 900;

let pass = 0;
let fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160));
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
// 等左索引渲染出省份分组（说明 content + geo 都已加载）
await page.waitForSelector('.index-group-title', { timeout: 30000 });
await page.waitForTimeout(2500);

/* ① 标题与计数 */
const title = (await page.textContent('.index-title'))?.trim() ?? '';
const count = (await page.textContent('.index-count'))?.trim() ?? '';
rec('左索引标题含「区域索引」与城市数', /区域索引/.test(title) && /\d+\s*市/.test(title), `"${title}"`);
rec('左索引计数显示「全国」', count === '全国', `"${count}"`);

/* ② 省份分组齐全（不含台湾省，其边界源 404 暂缺；其余 33 省级单元） */
const provinces = (await page.$$eval('.index-group-title', (els) => els.map((e) => e.textContent.replace(/\d+\s*市/, '').trim()))) ?? [];
const need = ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区', '香港特别行政区', '澳门特别行政区'];
const missing = need.filter((p) => !provinces.includes(p));
rec('左索引覆盖全部已录入省份（台湾除外）', missing.length === 0, missing.length ? `缺：${missing.join('、')}` : `${provinces.length} 个省级单元`);

/* ③ 无「江浙沪皖」硬编码残留 */
const bodyText = (await page.textContent('body')) ?? '';
rec('页面无「江浙沪皖」文案残留', !bodyText.includes('江浙沪皖'), bodyText.includes('江浙沪皖') ? '发现残留' : '已清除');

/* ④ 未录入省份显示「待录入」 */
const metaTexts = (await page.$$eval('.index-row .index-meta', (els) => els.map((e) => e.textContent.trim()))) ?? [];
const pending = metaTexts.filter((t) => t === '待录入').length;
rec('存在「待录入」城市（未录入省份）', pending > 0, `${pending} 个待录入`);

await page.screenshot({ path: path.join(OUT, 'nw-overview.png') });

/* ⑤ 北京（已录入）下钻有内容 */
await page.evaluate(() => window.__sandboxApp.focusCityById('110000'));
await page.waitForTimeout(2800);
const beijingBack = (await page.textContent('.index-back'))?.trim() ?? '';
const districtRows = await page.$$('.index-row--district');
rec('北京下钻后出现区县列表（16 个）', districtRows.length === 16, `${districtRows.length} 个`);
// 已录入区县应显示「N 景点」
const spotMetas = (await page.$$eval('.index-row--district:not(.is-empty) .index-meta', (els) => els.map((e) => e.textContent.trim()))) ?? [];
const withSpots = spotMetas.filter((t) => /景点/.test(t)).length;
rec('北京已录入区县显示景点数', withSpots > 0, `${withSpots} 个有景点`);
rec('北京下钻返回按钮显示「← 全国」', beijingBack.includes('全国'), `"${beijingBack}"`);
await page.screenshot({ path: path.join(OUT, 'nw-beijing.png') });

/* ⑥ 未录入城市点击弹「内容尚未录入」提示 */
// 回到总览
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(2200);
// 找广州市（440100，未录入）那一行并点击
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.index-row')];
  const row = rows.find((r) => r.textContent.includes('广州市'));
  if (!row) return false;
  row.click();
  return true;
});
await page.waitForTimeout(800);
const toastText = (await page.textContent('body')) ?? '';
rec('点击未录入城市弹出「尚未录入」提示', clicked && /尚未录入|内容尚未/.test(toastText), clicked ? (toastText.includes('尚未录入') || toastText.includes('内容尚未') ? '已弹提示' : '未见提示') : '未找到广州市行');

/* ⑦ 全程无 JS 运行时错误 */
rec('加载与交互无 JS 运行时错误', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : '无');

await browser.close();
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
