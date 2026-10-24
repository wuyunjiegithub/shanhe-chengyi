// v0.9.19 照片墙渲染核查：
// ① 网格瓦片是否为正常的 4:3 方块（不是被压扁的细条）
// ② 懒加载：打开时只取视口附近的本地照片，而不是一次性 31 张全取（避免手机 OOM/ANR）
// ③ 顶部头部留白是否过大（区县/市区详情页）
//
// 手机端用 Android UA + 桩版 __TAURI_INTERNALS__ 模拟套壳环境。
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import path from 'node:path';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

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

let fetchCount = 0;
const stub = () => {
  const pngUrl = (w, h, n) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${(n * 37) % 360} 70% 55%)`;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff';
    x.font = '20px sans-serif';
    x.fillText('IMG' + n, 10, 30);
    return c.toDataURL('image/png');
  };
  const urlToBytes = (url) => {
    const bin = atob(url.split(',')[1]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  const photos = [];
  for (let i = 1; i <= 31; i++) {
    photos.push({
      id: i, bucket: '淳安县', name: `照片${i}.jpg`, path: `/DCIM/Camera/${i}.jpg`,
      uri: `content://media/external/images/media/${i}`, mtime: 1700000000000 + i * 1000,
      width: 1200, height: 900, mime: 'image/jpeg',
    });
  }
  // 拦截取流调用，计数
  const realInvoke = async (cmd, args) => {
    switch (cmd) {
      case 'media_permission_state': return true;
      case 'media_request_permission': return true;
      case 'media_list_albums': return [{ name: '淳安县', count: 31 }];
      case 'media_all_photos': return photos;
      case 'media_album_photos': return photos;
      case 'media_photo_bytes':
        window.__fetchCount = (window.__fetchCount || 0) + 1;
        return urlToBytes(pngUrl(1200, 900, (args && args.photo_id) || 0));
      case 'plugin:app|registerListener': return 0;
      default: throw new Error(`unstubbed invoke: ${cmd}`);
    }
  };
  window.__fetchCount = 0;
  window.__convertCount = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: realInvoke,
    convertFileSrc: (p) => { window.__convertCount = (window.__convertCount || 0) + 1; return pngUrl(1200, 900, 0); },
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
page.on('console', (m) => {
  if (m.type() === 'error' && !/429|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160));
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 40000 });
await page.waitForSelector('.hud-top', { timeout: 20000 });
await page.waitForTimeout(3000);

/* 打开淳安县照片墙（31 张本地照片） */
await page.evaluate(() => window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }));
await page.waitForSelector('.wall-gallery', { timeout: 8000 });
await page.waitForTimeout(2500);

/* ① 瓦片宽高比：要量【瓦片本身】(.wall-tile) 的高度，而不是内层图片盒。
 * 之前的 bug 正是：图片盒按比例撑到 273px，但父级 .wall-tile 只有 9px + overflow:hidden，
 * 图片被裁成细条。所以必须校验 .wall-tile 的真实高度。 */
const tileStats = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.wall-tile')];
  const boxes = tiles.map((el) => {
    const r = el.getBoundingClientRect();
    const img = el.querySelector('.wall-tile-img');
    const ir = img ? img.getBoundingClientRect() : { width: 0, height: 0 };
    return { w: Math.round(r.width), h: Math.round(r.height), imgH: Math.round(ir.height) };
  });
  // 瓦片高度应明显大于宽度的一半（正常 4:3 约 0.75 倍宽 + 展签），细条会 < 0.4 倍
  const bad = boxes.filter((b) => b.h < b.w * 0.4);
  const sample = boxes.slice(0, 6);
  return { count: tiles.length, badCount: bad.length, sample };
});
rec('照片墙瓦片比例正常(非细条)', tileStats.badCount === 0, `瓦片数=${tileStats.count} 异常(细条)数=${tileStats.badCount} 样本=${JSON.stringify(tileStats.sample)}`);

/* ② 懒加载：打开瞬间取流次数应远小于 31（只有视口附近）；同时确认可见瓦片确实出了图 */
const fc = await page.evaluate(() => window.__fetchCount || 0);
const cc = await page.evaluate(() => window.__convertCount || 0);
const imgInfo = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.wall-gallery .wall-media-img')];
  const withSrc = imgs.filter((i) => (i.getAttribute('src') || '').startsWith('data:')).length;
  return { total: imgs.length, withSrc };
});
const galDiag = await page.evaluate(() => {
  const g = document.querySelector('.wall-gallery');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  const tiles = [...document.querySelectorAll('.wall-tile')];
  const vh = window.innerHeight;
  const inViewport = tiles.filter((t) => {
    const tr = t.getBoundingClientRect();
    return tr.top < vh && tr.bottom > 0;
  }).length;
  return {
    galleryClientH: Math.round(g.clientHeight),
    galleryScrollH: Math.round(g.scrollHeight),
    galleryTop: Math.round(r.top),
    tilesTotal: tiles.length,
    tilesInViewport: inViewport,
    vh: vh,
  };
});
console.log('GALLERY DIAG:', JSON.stringify(galDiag));

const cs = await page.evaluate(() => {
  const tile = document.querySelector('.wall-tile');
  const img = document.querySelector('.wall-tile-img');
  const g = document.querySelector('.wall-gallery');
  const modal = document.querySelector('.wall-modal');
  const bd = document.querySelector('.wall-backdrop');
  const pick = (el, props) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = c.getPropertyValue(p);
    const r = el.getBoundingClientRect();
    o._rect = { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
    return o;
  };
  return {
    tile: pick(tile, ['display', 'flex-direction', 'height', 'min-height']),
    img: pick(img, ['display', 'aspect-ratio', 'height', 'width', 'flex']),
    gallery: pick(g, ['display', 'grid-template-columns', 'overflow', 'flex', 'min-height', 'height']),
    modal: pick(modal, ['display', 'flex-direction', 'height', 'min-height', 'overflow']),
    backdrop: pick(bd, ['display', 'height', 'overflow']),
  };
});
console.log('CS DUMP:', JSON.stringify(cs, null, 1));
rec('懒加载：打开瞬间未全量取流', (fc + cc) < 31 && (fc + cc) > 0, `invoke取流=${fc} convertFileSrc=${cc} 共${(fc + cc)}/31`);
rec('可见瓦片已出图(非空白)', imgInfo.withSrc > 0, `画廊内 img=${imgInfo.total} 已出图=${imgInfo.withSrc}`);

await page.screenshot({ path: 'regression-shots/wall-mobile.png', fullPage: false });
console.log('SCREENSHOT: regression-shots/wall-mobile.png');

/* ③ 顶部头部留白（地图页 app-bar） */
const headPad = await page.evaluate(() => {
  const bar = document.querySelector('.app-bar') || document.querySelector('.top-bar');
  if (!bar) return null;
  const r = bar.getBoundingClientRect();
  const cs = getComputedStyle(bar);
  return { top: Math.round(r.top), padTop: cs.paddingTop, height: Math.round(r.height) };
});
console.log('APPBAR:', JSON.stringify(headPad));

console.log('\n错误:', errs.length ? errs.slice(0, 5) : '无');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n汇总: ${results.length - failed}/${results.length} 通过`);
await browser.close();
process.exit(failed ? 1 : 0);
