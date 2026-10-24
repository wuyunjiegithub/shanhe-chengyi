// 富文本编辑器工具栏「悬浮/钉住」回归：
// 手机端打开游记编辑器，往正文塞满内容让 .rt-body 可滚动，然后滚动正文，
// 校验工具栏(.rt-toolbar)位置纹丝不动、且始终在视口内。
// 关键：外层 .note-editor-scroll 不能是滚动容器（overflow:hidden），滚动只发生在 .rt-body。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: UA_ANDROID });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(2500);

await page.evaluate(() => window.__sandboxApp.openTravelEditor({ kind: 'district', id: '330127', name: '淳安县' }));
await page.waitForSelector('.rt-toolbar', { timeout: 8000 });
await page.waitForTimeout(800);

// 塞满正文，让 .rt-body 出现内部滚动
await page.evaluate(() => {
  const body = document.querySelector('.rt-body');
  let html = '';
  for (let i = 0; i < 60; i++) html += `<p>这是第 ${i + 1} 行测试正文，用来把编辑器正文撑到需要滚动的高度。</p>`;
  body.innerHTML = html;
  body.scrollTop = 0;
});
await page.waitForTimeout(300);

const before = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  const body = document.querySelector('.rt-body');
  const scrollWrap = document.querySelector('.note-editor-scroll');
  const tbr = tb.getBoundingClientRect();
  return {
    toolbarTop: Math.round(tbr.top),
    toolbarBottom: Math.round(tbr.bottom),
    toolbarPos: getComputedStyle(tb).position,
    bodyClientH: body.clientHeight,
    bodyScrollH: body.scrollHeight,
    bodyOverflow: getComputedStyle(body).overflowY,
    scrollWrapClientH: scrollWrap.clientHeight,
    scrollWrapScrollH: scrollWrap.scrollHeight,
    scrollWrapOverflow: getComputedStyle(scrollWrap).overflowY,
    vh: window.innerHeight,
  };
});
console.log('BEFORE:', JSON.stringify(before));

// 滚动正文到底
await page.evaluate(() => { const b = document.querySelector('.rt-body'); b.scrollTop = b.scrollHeight; });
await page.waitForTimeout(300);
const after = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  const body = document.querySelector('.rt-body');
  const tbr = tb.getBoundingClientRect();
  return { toolbarTop: Math.round(tbr.top), bodyScrollTop: Math.round(body.scrollTop) };
});
console.log('AFTER:', JSON.stringify(after));

// ① 正文确实在滚动（scrollTop > 0），说明有滚动空间
rec('正文可内部滚动', after.bodyScrollTop > 0 && before.bodyScrollH > before.bodyClientH, `scrollTop=${after.bodyScrollTop} bodyScrollH=${before.bodyScrollH} bodyClientH=${before.bodyClientH}`);
// ② 外层 .note-editor-scroll 不是滚动容器（手机上 overflow:hidden 且内容不超出）
rec('外层容器不滚动', before.scrollWrapOverflow === 'hidden', `overflowY=${before.scrollWrapOverflow} clientH=${before.scrollWrapClientH} scrollH=${before.scrollWrapScrollH}`);
// ③ 工具栏是结构上的固位元素（非 sticky/fixed），且滚动正文后位置不变
rec('滚动正文后工具栏钉住不动', Math.abs(after.toolbarTop - before.toolbarTop) <= 1, `top before=${before.toolbarTop} after=${after.toolbarTop}`);
// ④ 工具栏始终可见（在视口内）
rec('工具栏在视口内可见', before.toolbarTop >= 0 && before.toolbarBottom <= before.vh && before.toolbarBottom > before.toolbarTop, `top=${before.toolbarTop} bottom=${before.toolbarBottom} vh=${before.vh}`);

await page.screenshot({ path: 'regression-shots/editor-toolbar-mobile.png' });
console.log('SCREENSHOT: regression-shots/editor-toolbar-mobile.png');
console.log('\n错误:', errs.length ? errs.slice(0, 4) : '无');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
