import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'regression-shots';

const log = (...a) => console.log(...a);
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  log(`  · 截图 ${name}.png`);
};

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

try {
  // ---------- 启动 ----------
  log('▶ 加载应用');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.hud-top', { timeout: 15000 });
  await page.waitForTimeout(1400);
  await shot(page, 'r1-region');

  // ---------- #1 选中城市：基座 + 平滑抬升 ----------
  log('▶ #1 城市抬升截面（基座）');
  const pedestalBefore = await page.evaluate(() => {
    const s = window.__sandboxScene;
    const rec = s.cities.get('330100');
    return { has: !!rec?.pedestal, y: rec?.mesh.position.y ?? null, scale: rec?.pedestal?.scale.y ?? null };
  });
  log(`  静态态：基座存在=${pedestalBefore.has} 板高=${pedestalBefore.y} 基座高=${pedestalBefore.scale}`);
  // 悬停杭州 → 应抬升且基座长出
  await page.evaluate(() => {
    const s = window.__sandboxScene;
    s.setHover('city:330100');
  });
  await page.waitForTimeout(450);
  const pedestalHover = await page.evaluate(() => {
    const s = window.__sandboxScene;
    const rec = s.cities.get('330100');
    return { y: rec?.mesh.position.y ?? null, scale: rec?.pedestal?.scale.y ?? null, target: rec?.targetY ?? null };
  });
  log(`  悬停态：板高=${pedestalHover.y?.toFixed(3)} 基座高=${pedestalHover.scale?.toFixed(3)} 目标=${pedestalHover.target}`);
  if (!pedestalHover.has && !(pedestalHover.scale > 0.05)) throw new Error('悬停时基座未长出');
  if (!(pedestalHover.y > 0.1)) throw new Error('悬停时板块未抬升');
  if (Math.abs(pedestalHover.y - pedestalHover.target) > 0.2) throw new Error('抬升未在预期时间内收敛');
  if (Math.abs(pedestalHover.scale - (pedestalHover.y + 0.02)) > 0.06) throw new Error('基座未跟随板高');
  await shot(page, 'r2-city-lift');
  await page.evaluate(() => window.__sandboxScene.setHover(null));
  await page.waitForTimeout(400);
  const pedestalAfter = await page.evaluate(() => {
    const rec = window.__sandboxScene.cities.get('330100');
    return { y: rec?.mesh.position.y ?? null, scale: rec?.pedestal?.scale.y ?? null };
  });
  log(`  取消悬停：板高=${pedestalAfter.y?.toFixed(3)} 基座高=${pedestalAfter.scale?.toFixed(3)}`);
  if (!(pedestalAfter.scale < 0.05)) throw new Error('取消悬停后基座未收回');

  // ---------- 进入杭州 ----------
  log('▶ 下钻杭州市');
  await page.locator('.index-row:not(.is-empty)', { hasText: '杭州市' }).first().click();
  await page.waitForSelector('.city-panel', { timeout: 10000 });
  await page.waitForTimeout(900);
  const cityName = await page.locator('.city-cover-name').textContent().catch(() => '');
  log(`  当前城市：${(cityName ?? '').trim()}`);
  if ((cityName ?? '').trim() !== '杭州市') throw new Error(`未进入杭州市：${cityName}`);
  await shot(page, 'r3-city');

  // ---------- #4 城区文案 ----------
  log('▶ #4 「城区在哪」→「城区」');
  const urbanTitle = await page.locator('.city-urban .block-title').first().textContent().catch(() => '');
  const urbanText = (urbanTitle ?? '').replace(/\s+/g, '');
  log(`  城区板块标题：${urbanText}`);
  if (!urbanText.includes('城区') || urbanText.includes('城区在哪')) throw new Error(`城区标题异常：${urbanText}`);

  // ---------- #3 去过标记 ----------
  log('▶ #3 「去过」印章图标');
  const flagBtn = page.locator('.city-act--flag');
  await flagBtn.waitFor({ timeout: 8000 });
  const flagOff = await flagBtn.textContent();
  const svgOff = await page.locator('.city-act--flag .visited-mark').count();
  log(`  未标记：文案=${(flagOff ?? '').trim()} SVG=${svgOff}`);
  if (svgOff !== 1) throw new Error('去过按钮缺少印章图标');
  await flagBtn.click();
  await page.waitForTimeout(350);
  const flagOn = await flagBtn.textContent();
  const onClass = await page.locator('.city-act--flag .visited-mark.is-on').count();
  const sealFill = await page.evaluate(() => {
    const seal = document.querySelector('.city-act--flag .visited-mark.is-on .visited-mark__seal');
    return seal ? getComputedStyle(seal).fill : '';
  });
  log(`  已标记：文案=${(flagOn ?? '').trim()} is-on=${onClass} 印章填充=${sealFill}`);
  if (onClass !== 1) throw new Error('点击后未进入 is-on 态');
  if (!/rgb/.test(sealFill)) throw new Error('印章未填充颜色');
  await shot(page, 'r4-visited');
  // 还原
  await flagBtn.click();
  await page.waitForTimeout(250);

  // ---------- 打开淳安县抽屉 ----------
  log('▶ 打开淳安县抽屉');
  const dRow = page.locator('.index-row--district', { hasText: '淳安县' }).first();
  await dRow.waitFor({ timeout: 8000 });
  await dRow.click();
  await page.waitForSelector('.drawer-inner', { timeout: 10000 });
  await page.waitForTimeout(900);
  await shot(page, 'r5-drawer');

  // ---------- #2 本区县美食 + 特产非遗 ----------
  log('▶ #2 区县自有美食 + 特产/非遗');
  const foodNames = await page.locator('.drawer .food-card-name').allTextContents();
  log(`  抽屉美食：${foodNames.join(' / ')}`);
  if (!foodNames.some((n) => n.includes('千岛湖鱼头'))) throw new Error(`未展示淳安自有美食：${foodNames.join(',')}`);
  if (foodNames.some((n) => n.includes('西湖醋鱼') || n.includes('龙井虾仁'))) throw new Error('仍混入杭州城区美食');
  const specNames = await page.locator('.drawer .specialty-name').allTextContents();
  const specKinds = await page.locator('.drawer .specialty-kind').allTextContents();
  log(`  特产非遗：${specNames.map((n, i) => `${specKinds[i]}·${n}`).join(' / ')}`);
  if (!specNames.some((n) => n.includes('淳安'))) throw new Error(`未展示淳安特产：${specNames.join(',')}`);
  if (!specKinds.includes('非遗')) throw new Error('缺少非遗条目');
  await shot(page, 'r6-specialty');

  // ---------- #6 抽屉标题间距 ----------
  log('▶ #6 抽屉标题间距');
  const titleBox = await page.locator('.drawer-title-wrap').boundingBox();
  const coverBox = await page.locator('.drawer-cover').boundingBox();
  const gap = titleBox && coverBox ? coverBox.y - (titleBox.y + titleBox.height) : null;
  const coverMarginTop = await page.evaluate(() => getComputedStyle(document.querySelector('.drawer-cover')).marginTop);
  log(`  标题块底→封面上沿间距=${gap?.toFixed(1)}px 封面上边距=${coverMarginTop}`);
  if (gap !== null && gap < 4) throw new Error(`标题仍贴着封面：间距 ${gap}px`);
  if (coverMarginTop !== '0px') throw new Error(`封面仍有上边距侵入：${coverMarginTop}`);

  // ---------- #5 照片墙多风格 ----------
  log('▶ #5 展览馆式照片墙');
  await page.locator('.photo-wall-trigger').first().click();
  await page.waitForSelector('.wall-modal', { timeout: 8000 });
  await page.waitForTimeout(600);
  const styleChips = await page.locator('.wall-style-chip').allTextContents();
  log(`  风格切换：${styleChips.join(' / ')}`);
  if (styleChips.join(',').replace(/\s/g, '') !== '展厅,长廊,灯箱,拼贴') throw new Error(`风格按钮异常：${styleChips.join(',')}`);
  await shot(page, 'r7-wall-gallery');

  for (const [name, sel] of [
    ['长廊', '.wall-stage'],
    ['灯箱', '.wall-stage-img'],
    ['拼贴', '.wall-collage'],
  ]) {
    await page.locator('.wall-style-chip', { hasText: name }).click();
    await page.waitForTimeout(450);
    const ok = (await page.locator(sel).count()) > 0;
    log(`  切到「${name}」：渲染=${ok}`);
    if (!ok) throw new Error(`「${name}」风格未渲染`);
    await shot(page, `r7-wall-${name}`);
  }
  // 键盘切换
  await page.locator('.wall-style-chip', { hasText: '灯箱' }).click();
  await page.waitForTimeout(300);
  const idxBefore = await page.locator('.wall-stage-index').textContent();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  const idxAfter = await page.locator('.wall-stage-index').textContent();
  log(`  键盘切换：${(idxBefore ?? '').trim()} → ${(idxAfter ?? '').trim()}`);
  if ((idxBefore ?? '').trim() === (idxAfter ?? '').trim()) throw new Error('方向键未切换图片');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await page.locator('.wall-modal').count()) !== 0) throw new Error('Esc 未关闭照片墙');

  // ---------- #5 照片库绑定面板 ----------
  log('▶ #5 照片库绑定面板');
  await page.locator('.data-pill--photo').click();
  await page.waitForSelector('.photo-lib', { timeout: 8000 });
  const treeText = await page.locator('.photo-lib-tree').textContent();
  log(`  目录约定示例：${(treeText ?? '').split('\n')[0]} …（共 ${(treeText ?? '').split('\n').length} 行）`);
  if (!(treeText ?? '').includes('淳安县')) throw new Error('目录约定未说明区县级文件夹');
  const bindBtn = await page.locator('.photo-lib-actions .primary-btn').textContent();
  log(`  绑定按钮：${(bindBtn ?? '').trim()}`);
  await shot(page, 'r8-photolib');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await page.locator('.photo-lib').count()) !== 0) throw new Error('Esc 未关闭照片库面板');

  // ---------- 汇总 ----------
  log('\n──────── 结果 ────────');
  if (errors.length) {
    log(`发现 ${errors.length} 个错误：`);
    for (const e of errors) log('  ' + e);
    process.exitCode = 1;
  } else {
    log('✅ 控制台 0 错误 / 页面异常 0；六项调整全部通过');
  }
} catch (err) {
  log('\n❌ 回归失败：' + (err instanceof Error ? err.message : String(err)));
  await shot(page, 'r9-error').catch(() => {});
  for (const e of errors) log('  ' + e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
