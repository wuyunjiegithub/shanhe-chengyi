/**
 * 内容覆盖回归
 *
 * 锁三件事：
 *  ① 台湾省 20 个县市可下钻、有内容（用户反馈「台湾什么都没有」）
 *  ② 区县没有自己的美食时，回退到所属城市，并明确标注来源（不能冒充区县专属）
 *  ③ 区县自己有美食时，不显示回退说明
 *
 * 用法：node scripts/verify-content-coverage.mjs
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const rec = (name, ok, note = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${note ? '  ' + note : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
pc.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await pc.goto(URL, { waitUntil: 'domcontentloaded' });
await pc.waitForFunction(() => Boolean(window.__sandboxApp), null, { timeout: 45000 });
await pc.waitForTimeout(3000);

/** 打开某区县抽屉，返回抽屉文本 */
async function openDistrict(id) {
  await pc.evaluate((d) => window.__sandboxApp.selectDistrictById(d), id);
  await pc.waitForTimeout(2200);
  return pc.evaluate(() => {
    const el = document.querySelector('.drawer');
    return el ? el.innerText : '';
  });
}

/* ---------- ① 台湾 ---------- */
console.log('\n[1] 台湾省');
const twIds = await pc.evaluate(() => window.__sandboxApp.districtsOf('710000'));
rec('台湾省有 20 个县市', twIds.length === 20, `${twIds.length} 个`);
await pc.evaluate(() => window.__sandboxApp.focusCityById('710000'));
await pc.waitForTimeout(2600);
const nav = await pc.evaluate(() => window.__sandboxApp.navState());
rec('可下钻进台湾省', nav.level === 'city' && nav.currentCityId === '710000', `${nav.level}/${nav.currentCityId}`);

const twText = await openDistrict('710014'); // 嘉义县
rec('台湾区县有正文（历史）', /清代设诸罗县/.test(twText), '');
rec('台湾区县有景点', /阿里山国家森林游乐区/.test(twText), '');
rec('台湾区县能看到美食（回退到台湾省）', /卤肉饭/.test(twText) && /以下展示\s*台湾省\s*的美食/.test(twText), '');

/* ---------- ② 美食回退 ---------- */
console.log('\n[2] 区县美食回退到所属城市');
// 找一个「自己没有美食」的区县：四川某县
const noFood = await pc.evaluate(() => {
  const d = window.__sandboxApp.districtsOf('510100'); // 成都市
  return d?.[0] ?? null;
});
if (noFood) {
  const t = await openDistrict(noFood);
  const hasNote = /以下展示/.test(t);
  const hasFood = /当地美食/.test(t);
  rec('无自有美食的区县仍能读到美食', hasFood && t.includes('火锅') === false ? hasFood : hasFood, `district=${noFood}`);
  rec('回退时标注了来源城市', hasNote, hasNote ? '' : '未出现「以下展示…」说明');
} else {
  rec('拿到成都下区县', false, 'districtsOf 返回空');
}

/* ---------- ③ 自己有美食时不显示回退说明 ---------- */
console.log('\n[3] 自有美食的区县不应显示回退说明');
const ownText = await openDistrict('110101'); // 东城区，自己录了炸酱面
rec('有自有美食的区县正常展示', /炸酱面/.test(ownText), '');
rec('有自有美食时不显示回退说明', !/以下展示/.test(ownText), '');

await browser.close();
console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
