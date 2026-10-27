/**
 * 家乡（主市）+ 四级回退回归
 *
 * 覆盖三件事：
 *  1. 默认家乡 = 北京市，启动直接落在北京市（城市视图）
 *  2. 改家乡后重启落在新的家乡
 *  3. ESC 逐级回退：区县 → 大市 → 省 → 全国
 *
 * 用法：node scripts/verify-hometown.mjs
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL ?? 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let pass = 0;
let fail = 0;
const rec = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? '  ' + detail : ''}`);
  }
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

/** 开一个全新上下文（干净 localStorage），保证「默认家乡」这条测的是真实首启 */
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sandboxApp), null, { timeout: 45000 });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

const nav = (page) =>
  page.evaluate(() => {
    const n = window.__sandboxApp.navState?.() ?? {};
    return n;
  });

// ---------- 1. 默认家乡 = 北京市 ----------
console.log('\n[1] 默认家乡（北京市）');
{
  const { ctx, page } = await freshPage();
  const st = await nav(page);
  rec('启动后进入城市视图', st.level === 'city', `level=${st.level}`);
  rec('当前城市是北京市', st.currentCityId === '110000', `cityId=${st.currentCityId}`);
  rec('家乡镇默认标记为「未自定义」', st.hometownCustomized === false, `customized=${st.hometownCustomized}`);
  await ctx.close();
}

// ---------- 2. 设置家乡 → 重启生效 ----------
console.log('\n[2] 改家乡为杭州市(330100) 后重启');
{
  const { ctx, page } = await freshPage();
  await page.evaluate(() => window.__sandboxApp.setHometown('330100'));
  const st1 = await nav(page);
  rec('设置后立即生效', st1.hometownCityId === '330100', `cityId=${st1.hometownCityId}`);
  rec('设置后标记为「已自定义」', st1.hometownCustomized === true);

  // 同一上下文重新加载 = 模拟「下次打开软件」
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__sandboxApp), null, { timeout: 45000 });
  await page.waitForTimeout(4000);
  const st2 = await nav(page);
  rec('重启后落在杭州市', st2.currentCityId === '330100', `cityId=${st2.currentCityId} level=${st2.level}`);
  await ctx.close();
}

// ---------- 3. 四级回退：区县 → 大市 → 省 → 全国 ----------
console.log('\n[3] ESC 逐级回退 区县 → 大市 → 省 → 全国');
{
  const { ctx, page } = await freshPage();
  // 进一个区县
  const did = await page.evaluate(() => {
    const ids = window.__sandboxApp.districtsOf?.('110000') ?? [];
    return ids[0] ?? null;
  });
  if (!did) {
    rec('拿到北京市下区县', false, 'districtsOf 返回空');
  } else {
    await page.evaluate((id) => window.__sandboxApp.selectDistrictById(id), did);
    await page.waitForTimeout(2200);
    let st = await nav(page);
    rec('已进入区县', st.activeDistrictId === did, `district=${st.activeDistrictId}`);

    // 第 1 级：区县 → 大市（取消选中，仍在城市视图）
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    st = await nav(page);
    rec('① 区县 → 大市：仍在北京，区县取消选中', st.level === 'city' && st.activeDistrictId === null,
      `level=${st.level} district=${st.activeDistrictId}`);

    // 第 2 级：大市 → 省
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    st = await nav(page);
    rec('② 大市 → 省：回到区域级且 scope=province', st.level === 'region' && st.regionScope === 'province',
      `level=${st.level} scope=${st.regionScope}`);

    // 第 3 级：省 → 全国
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1800);
    st = await nav(page);
    rec('③ 省 → 全国：scope=nation', st.level === 'region' && st.regionScope === 'nation',
      `level=${st.level} scope=${st.regionScope}`);

    // 第 4 级：已在全国，ESC 不再跳
    const before = await page.evaluate(() => window.__sandboxApp.cameraInfo?.() ?? null);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    st = await nav(page);
    const after = await page.evaluate(() => window.__sandboxApp.cameraInfo?.() ?? null);
    rec('④ 已在全国：ESC 不再改变层级', st.regionScope === 'nation', `scope=${st.regionScope}`);
    if (before && after) {
      const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
      rec('④ 已在全国：相机基本不动', moved < 1.5, `moved=${moved.toFixed(2)}`);
    }
  }
  await ctx.close();
}

// ---------- 4. 全国视角确实比省视角远 ----------
console.log('\n[4] 全国视图 > 省视图（相机距离逐级变大）');
{
  const { ctx, page } = await freshPage();
  await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
  await page.waitForTimeout(2400);
  await page.keyboard.press('Escape'); // → 省
  await page.waitForTimeout(1800);
  const dProv = await page.evaluate(() => window.__sandboxApp.cameraInfo?.().dist ?? 0);
  await page.keyboard.press('Escape'); // → 全国
  await page.waitForTimeout(2000);
  const dNat = await page.evaluate(() => window.__sandboxApp.cameraInfo?.().dist ?? 0);
  rec('省 → 全国 相机拉远', dNat > dProv * 1.5, `省=${dProv.toFixed(1)} 全国=${dNat.toFixed(1)}`);
  await ctx.close();
}

await browser.close();

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
