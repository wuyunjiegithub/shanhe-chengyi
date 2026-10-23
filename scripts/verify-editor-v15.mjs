// v0.9.15 富文本编辑器增强核查：
// ① 插入图片保持原图尺寸（超宽才缩到正文宽）  ② 拖右下角手柄自定义调整大小（比例不变）
// ③ 字体下拉（常见默认字体）                  ④ width / font 经清洗后仍能存下来、重开不丢
// ⑤ 系统相册无 DATA 路径的照片在选图器里不再互相撞键
//
// 手机端用 Android UA + 桩版 __TAURI_INTERNALS__ 模拟套壳环境（相册桥走桩，
// 桩里的 PNG 按指定尺寸用 canvas 现画，保证 naturalWidth/Height 真实可测）。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import path from 'node:path';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');

const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

// 桩：整个函数体会被序列化进页面，不能依赖外部闭包变量
const stub = () => {
  // path / uri -> 尺寸（桩里按这个尺寸现画 PNG，naturalWidth 才真实）
  const SIZE_BY_PATH = {
    '/DCIM/Camera/a.jpg': [240, 320],
    '/DCIM/Camera/b.jpg': [1080, 1440],
    '/DCIM/Camera/c.jpg': [800, 600],
  };
  const SIZE_BY_URI = {
    'content://media/external/images/media/11': [240, 320],
    'content://media/external/images/media/12': [1080, 1440],
    'content://media/external/images/media/13': [800, 600],
    'content://media/external/images/media/14': [300, 300],
    'content://media/external/images/media/15': [200, 200],
    'content://media/external/images/media/21': [900, 1200],
    'content://media/external/images/media/22': [1200, 900],
  };
  const pngUrl = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f43f5e');
    g.addColorStop(1, '#0ea5e9');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c.toDataURL('image/png');
  };
  const urlToBytes = (url) => {
    const bin = atob(url.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  const albums = [
    { name: '淳安县', count: 5 },
    { name: '杭州市', count: 2 },
  ];
  const photos = [
    { id: 11, bucket: '淳安县', name: '小图-竖版.jpg', path: '/DCIM/Camera/a.jpg', uri: 'content://media/external/images/media/11', mtime: 1700000000000, width: 240, height: 320, mime: 'image/jpeg' },
    { id: 12, bucket: '淳安县', name: '大图-竖版.jpg', path: '/DCIM/Camera/b.jpg', uri: 'content://media/external/images/media/12', mtime: 1700000100000, width: 1080, height: 1440, mime: 'image/jpeg' },
    { id: 13, bucket: '淳安县', name: '中图-横版.jpg', path: '/DCIM/Camera/c.jpg', uri: 'content://media/external/images/media/13', mtime: 1700000200000, width: 800, height: 600, mime: 'image/jpeg' },
    // 两张都没有 DATA 路径（部分新机型）：旧代码会互相撞键只显示一张
    { id: 14, bucket: '淳安县', name: '无路径图A.jpg', path: '', uri: 'content://media/external/images/media/14', mtime: 1700000250000, width: 300, height: 300, mime: 'image/jpeg' },
    { id: 15, bucket: '淳安县', name: '无路径图B.jpg', path: '', uri: 'content://media/external/images/media/15', mtime: 1700000260000, width: 200, height: 200, mime: 'image/jpeg' },
    { id: 21, bucket: '杭州市', name: '西湖.jpg', path: '/DCIM/Camera/d.jpg', uri: 'content://media/external/images/media/21', mtime: 1700000300000, width: 900, height: 1200, mime: 'image/jpeg' },
    { id: 22, bucket: '杭州市', name: '灵隐.jpg', path: '/DCIM/Camera/e.jpg', uri: 'content://media/external/images/media/22', mtime: 1700000400000, width: 1200, height: 900, mime: 'image/jpeg' },
  ];
  window.__TAURI_INTERNALS__ = {
    // dialog 插件 open() 会建 Channel（真实壳里由 Tauri 提供），桩里给个空实现
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      switch (cmd) {
        case 'media_permission_state': return true;
        case 'media_request_permission': return true;
        case 'media_list_albums': return albums;
        case 'media_all_photos': return photos;
        case 'media_album_photos': return photos.filter((p) => p.bucket === args?.album);
        case 'media_photo_bytes': {
          const size = SIZE_BY_URI[args?.uri] || [1200, 900];
          return urlToBytes(pngUrl(size[0], size[1]));
        }
        // Tauri 事件插件在壳里由 registerListener 处理，桩里返回个空 id
        case 'plugin:app|registerListener': return 0;
        default: throw new Error(`unstubbed invoke: ${cmd}`);
      }
    },
    convertFileSrc: (p) => {
      const size = SIZE_BY_PATH[p];
      return size ? pngUrl(size[0], size[1]) : pngUrl(1200, 900);
    },
  };
};

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: UA_ANDROID,
});
await page.addInitScript(stub);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errs.push('console: ' + msg.text().slice(0, 160));
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3200);

/* ---------- 打开淳安县的游记编辑器 ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(500);

/* ---------- ⑤ 选图器：无 DATA 路径的两张都要在（按 entryKey 去重） ---------- */
await page.click('.rt-btn--img');
await page.waitForSelector('.np-backdrop', { timeout: 6000 });
await page.waitForTimeout(500);
const cells = await page.$$eval('.np-cell', (els) => els.map((e) => e.querySelector('.np-cell-name')?.textContent || ''));
rec('⑤ 选图器列出淳安县全部 5 张（无路径图不撞键）', cells.length === 5, JSON.stringify(cells));

// 勾选：小图(240×320) + 两张无路径图(300×300 / 200×200)
for (const name of ['小图-竖版.jpg', '无路径图A.jpg', '无路径图B.jpg']) {
  await page.evaluate((n) => {
    const cell = [...document.querySelectorAll('.np-cell')].find((c) => (c.querySelector('.np-cell-name')?.textContent || '') === n);
    cell?.click();
  }, name);
}
await page.waitForTimeout(200);
await page.click('.np-insert-btn');
// 等图片字节入库 + 插进正文 + load 出自然尺寸
await page.waitForFunction(
  () => {
    const imgs = document.querySelectorAll('.rt-body img[data-img]');
    return imgs.length === 3 && [...imgs].every((i) => i.complete && i.naturalWidth > 0);
  },
  { timeout: 15000 },
);
await page.waitForTimeout(300);

const readImgs = () =>
  page.evaluate(() => {
    const body = document.querySelector('.rt-body');
    const cs = getComputedStyle(body);
    const contentW = Math.round(body.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    return {
      contentW,
      imgs: [...document.querySelectorAll('.rt-body img[data-img]')].map((i) => ({
        widthAttr: i.getAttribute('width'),
        renderW: Math.round(i.offsetWidth),
        // clientWidth 去掉 1px 边框，才是 width 属性的真实生效值
        contentW2: i.clientWidth,
        renderH: Math.round(i.offsetHeight),
        natW: i.naturalWidth,
        natH: i.naturalHeight,
      })),
    };
  });

const afterInsert = await readImgs();
console.log('  插入后:', JSON.stringify(afterInsert));

/* ---------- ① 插入保持原图尺寸 ---------- */
const small = afterInsert.imgs[0]; // 240×320，比正文窄 → 原尺寸
rec('① 小图按原尺寸插入（240px）', small.widthAttr === '240' && small.renderW === 240, JSON.stringify(small));
rec(
  '① 小图高度按比例（320/240）',
  Math.abs(small.renderH / small.renderW - 320 / 240) < 0.02,
  `${small.renderH}/${small.renderW}`,
);
const uriA = afterInsert.imgs[1]; // 300×300，走 uri 兜底读字节
const uriB = afterInsert.imgs[2]; // 200×200
rec('① 无 DATA 路径的图也能按原尺寸插入（300/200）', uriA.widthAttr === '300' && uriB.widthAttr === '200', JSON.stringify([uriA, uriB]));

/* ---------- ② 拖动手柄调整大小 ---------- */
await page.click('.rt-body img[data-img]'); // 选中第一张 → 浮出手柄
await page.waitForSelector('.rt-img-resize', { timeout: 4000 });
const handle = await page.locator('.rt-img-resize').boundingBox();
rec('② 缩放手柄出现在图片右下角', !!handle, handle ? `${Math.round(handle.width)}×${Math.round(handle.height)}` : 'null');

const dragBy = async (dx) => {
  // 每次都重新取手柄位置：上一步缩放后图片变大，手柄也跟着移了
  const box = await page.locator('.rt-img-resize').boundingBox();
  if (!box) throw new Error('找不到缩放手柄');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 6 });
  await page.mouse.up();
};

await dragBy(60);
await page.waitForTimeout(250);
const afterGrow = await readImgs();
console.log('  拖大 60px 后:', JSON.stringify(afterGrow.imgs[0]));
rec('② 拖动后宽度 +60（240→300）', afterGrow.imgs[0].widthAttr === '300' && afterGrow.imgs[0].renderW === 300, JSON.stringify(afterGrow.imgs[0]));
rec(
  '② 拖动后比例不变（仍 320/240）',
  Math.abs(afterGrow.imgs[0].renderH / afterGrow.imgs[0].renderW - 320 / 240) < 0.02,
  `${afterGrow.imgs[0].renderH}/${afterGrow.imgs[0].renderW}`,
);

await dragBy(-120);
await page.waitForTimeout(250);
const afterShrink = await readImgs();
rec('② 反向拖动后宽度 -120（300→180）', afterShrink.imgs[0].widthAttr === '180' && afterShrink.imgs[0].renderW === 180, JSON.stringify(afterShrink.imgs[0]));
rec(
  '② 缩小后比例仍不变',
  Math.abs(afterShrink.imgs[0].renderH / afterShrink.imgs[0].renderW - 320 / 240) < 0.02,
  `${afterShrink.imgs[0].renderH}/${afterShrink.imgs[0].renderW}`,
);

/* ---------- ③ 字体下拉 ---------- */
// 先把光标落到正文末尾敲一行字（别把图片卷进选区：图不继承字体）
await page.evaluate(() => {
  const el = document.querySelector('.rt-body');
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false); // 光标移到末尾
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.keyboard.type('千岛湖的清晨');
await page.waitForTimeout(150);
// 只选这一行文字
await page.evaluate(() => {
  const el = document.querySelector('.rt-body');
  const p = [...el.querySelectorAll('p')].find((x) => (x.textContent || '').includes('千岛湖'));
  if (!p) return;
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.waitForTimeout(200);
await page.selectOption('.rt-font', { label: '楷体' });
await page.waitForTimeout(350);

const fontApplied = await page.evaluate(() => {
  const html = document.querySelector('.rt-body').innerHTML;
  const sel = document.querySelector('.rt-font');
  return {
    hasFontTag: /<font face="KaiTi/i.test(html),
    face: (html.match(/<font face="([^"]*)"/i) || [])[1] || '',
    selectValue: sel?.value || '',
  };
});
console.log('  字体应用后:', JSON.stringify(fontApplied));
rec('③ 选中文字套上楷体（<font face>）', fontApplied.hasFontTag, fontApplied.face);
rec('③ 下拉框回显当前字体（楷体）', /KaiTi/i.test(fontApplied.selectValue), fontApplied.selectValue);

/* ---------- ④ 保存后重开：宽度 / 字体都在 ---------- */
await page.click('.note-editor-head .primary-btn'); // 保存
await page.waitForSelector('.note-list', { timeout: 6000 });
await page.waitForTimeout(400);
await page.click('.note-card');
await page.waitForSelector('.rt-body img[data-img]', { timeout: 6000 });
await page.waitForTimeout(1200); // 等 hydrate 注入 src + load

const reopened = await page.evaluate(() => {
  const body = document.querySelector('.rt-body');
  return {
    html: body.innerHTML,
    imgs: [...body.querySelectorAll('img[data-img]')].map((i) => ({
      widthAttr: i.getAttribute('width'),
      renderW: Math.round(i.offsetWidth),
      contentW2: i.clientWidth,
      renderH: Math.round(i.offsetHeight),
      natW: i.naturalWidth,
      natH: i.naturalHeight,
    })),
    fontTag: /<font face="KaiTi/i.test(body.innerHTML),
  };
});
console.log('  重开后:', JSON.stringify(reopened.imgs), 'fontTag=' + reopened.fontTag);
rec('④ 重开笔记后图片宽度不丢（180/300/200）',
  reopened.imgs.map((i) => i.widthAttr).join(',') === '180,300,200',
  JSON.stringify(reopened.imgs.map((i) => i.widthAttr)));
rec('④ 重开笔记后字体不丢（楷体）', reopened.fontTag, String(reopened.fontTag));
rec(
  '④ 重开后比例仍正确',
  reopened.imgs.every((i) => Math.abs(i.renderH / i.renderW - i.natH / i.natW) < 0.02),
  JSON.stringify(reopened.imgs.map((i) => `${i.renderW}×${i.renderH}`)),
);

/* ---------- 选中态截图：删除钮 + 缩放手柄 ---------- */
await page.click('.rt-body img[data-img]');
await page.waitForSelector('.rt-img-resize', { timeout: 4000 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'v15-editor-img-sel.png') });
const selBox = await page.evaluate(() => {
  const img = document.querySelector('.rt-body img[data-img]');
  const del = document.querySelector('.rt-img-del');
  const rz = document.querySelector('.rt-img-resize');
  const i = img.getBoundingClientRect();
  const d = del?.getBoundingClientRect();
  const r = rz?.getBoundingClientRect();
  return {
    img: [Math.round(i.left), Math.round(i.top), Math.round(i.right), Math.round(i.bottom)],
    delInside: !!d && d.right <= i.right + 20 && d.bottom <= i.bottom + 20 && d.left >= i.left - 20,
    rzCorner: !!r && Math.abs(r.right - i.right) < 22 && Math.abs(r.bottom - i.bottom) < 22,
    outline: getComputedStyle(img).borderColor,
  };
});
rec('② 选中态：删除钮在图上、手柄钉右下角', selBox.delInside && selBox.rzCorner, JSON.stringify(selBox));

// 收起来（新游记没有删除钮，直接返回列表即可，不影响无头上下文）
await page.evaluate(() => {
  const back = [...document.querySelectorAll('.note-editor-head button')].find((b) => /返回列表/.test(b.textContent || ''));
  back?.click();
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'v15-editor-img-font.png') });

console.log('\npageerrors:', errs.length ? errs : '（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
