// v0.9.14 手机端五项修复核查：
// ① 照片墙关闭按钮在右上角  ② 写游记选图不弹键盘  ③ 键盘弹出后工具栏仍可点
// ④ 相册名绑定（淳安县）    ⑤ 初始 / 总览地图撑满屏幕
//
// 手机端用 Android UA + 桩版 __TAURI_INTERNALS__ 模拟套壳环境（相册桥走桩）。
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
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const albums = [
    { name: '淳安县', count: 3 },
    { name: '杭州市', count: 2 },
    { name: '相机', count: 40 },
  ];
  const photos = [
    // 淳安县 3 张：两张有 DATA 路径、一张没有（新机型行为，走 uri 兜底）
    { id: 11, bucket: '淳安县', name: '千岛湖1.jpg', path: '/DCIM/Camera/1.jpg', uri: 'content://media/external/images/media/11', mtime: 1700000000000, width: 4032, height: 3024, mime: 'image/jpeg' },
    { id: 12, bucket: '淳安县', name: '千岛湖2.jpg', path: '', uri: 'content://media/external/images/media/12', mtime: 1700000100000, width: 1080, height: 1920, mime: 'image/jpeg' },
    { id: 13, bucket: '淳安县', name: '千岛湖3.jpg', path: '/DCIM/Camera/3.jpg', uri: 'content://media/external/images/media/13', mtime: 1700000200000, width: 4032, height: 3024, mime: 'image/jpeg' },
    { id: 21, bucket: '杭州市', name: '西湖.jpg', path: '/DCIM/Camera/4.jpg', uri: 'content://media/external/images/media/21', mtime: 1700000300000, width: 4032, height: 3024, mime: 'image/jpeg' },
    { id: 22, bucket: '杭州市', name: '灵隐.jpg', path: '/DCIM/Camera/5.jpg', uri: 'content://media/external/images/media/22', mtime: 1700000400000, width: 3024, height: 4032, mime: 'image/jpeg' },
  ];
  for (let i = 0; i < 40; i++) {
    photos.push({ id: 100 + i, bucket: '相机', name: `IMG_${1000 + i}.jpg`, path: `/DCIM/Camera/c${i}.jpg`, uri: `content://media/external/images/media/${100 + i}`, mtime: 1700000500000 + i, width: 4032, height: 3024, mime: 'image/jpeg' });
  }
  const bin = atob(PNG);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
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
        case 'media_photo_bytes': return bytes.buffer;
        default: throw new Error(`unstubbed invoke: ${cmd}`);
      }
    },
    convertFileSrc: () => `data:image/png;base64,${PNG}`,
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
await page.waitForTimeout(3200); // 等相册索引建完 + 首屏取景稳定

/* ---------- ⑤ 初始地图（先测，别被后面的交互改了相机） ---------- */
const measureMap = () =>
  page.evaluate(() => {
    const s = window.__sandboxScene;
    const cam = s.camera;
    const el = s.renderer.domElement;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const proj = (v) => {
      const q = v.clone().project(cam);
      return [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H];
    };
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [, rec] of s.cities.entries()) {
      for (const mesh of rec.meshes) {
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        if (!bb) continue;
        for (const x of [bb.min.x, bb.max.x])
          for (const y of [bb.min.y, bb.max.y])
            for (const z of [bb.min.z, bb.max.z]) {
              const p = cam.position.clone();
              p.set(x, y, z);
              mesh.localToWorld(p);
              const [px, py] = proj(p);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }
      }
    }
    const anchors = {};
    for (const id of ['330100', '310000', '320100', '330200', '330300']) {
      const c = s.cities.get(id);
      if (!c) continue;
      const p = cam.position.clone();
      p.set(c.centroid[0], c.height, -c.centroid[1]);
      const [px, py] = proj(p);
      anchors[id] = [Math.round(px), Math.round(py)];
    }
    return {
      W, H,
      fillW: +((maxX - minX) / W).toFixed(3),
      fillH: +((maxY - minY) / H).toFixed(3),
      anchors,
    };
  });

const mapInit = await measureMap();
const cityVisible = Object.values(mapInit.anchors).every(
  ([x, y]) => x >= 0 && x <= mapInit.W && y >= 0 && y <= mapInit.H,
);
rec('⑤ 初始地图占屏高 ≥50%', mapInit.fillH >= 0.5, `fillH=${mapInit.fillH} fillW=${mapInit.fillW}`);
rec('⑤ 地图宽出屏（允许裁切）', mapInit.fillW >= 1.1, `fillW=${mapInit.fillW}`);
rec('⑤ 杭沪宁甬温均在屏内', cityVisible, JSON.stringify(mapInit.anchors));
await page.screenshot({ path: path.join(OUT, 'v14-map-initial.png') });

/* ---------- ④ 相册名绑定 ---------- */
await page.evaluate(() =>
  window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330127', title: '淳安县 · 照片墙' }),
);
await page.waitForSelector('.wall-modal', { timeout: 8000 });
await page.waitForTimeout(1400);

const wall = await page.evaluate(() => {
  const tiles = document.querySelectorAll('.wall-tile');
  const imgs = [...document.querySelectorAll('.wall-tile img, .wall-media-img')];
  return {
    tileCount: tiles.length,
    title: document.querySelector('.wall-title')?.textContent,
    srcs: imgs.map((i) => i.getAttribute('src') || i.src || '').slice(0, 5),
  };
});
rec('④ 淳安县相册照片进墙（3 张）', wall.tileCount === 3, `tiles=${wall.tileCount}`);
rec('④ 照片出图（asset / blob 兜底）', wall.srcs.some((s) => /^(blob:|asset:)/.test(s)), JSON.stringify(wall.srcs.slice(0, 3)));
await page.screenshot({ path: path.join(OUT, 'v14-wall-chunan.png') });

/* ① 关闭按钮在右上角 */
const closeBtn = await page.evaluate(() => {
  const btn = document.querySelector('.wall-close');
  const modal = document.querySelector('.wall-modal');
  const title = document.querySelector('.wall-head-title');
  const styles = document.querySelector('.wall-styles');
  if (!btn || !modal) return null;
  const b = btn.getBoundingClientRect();
  const m = modal.getBoundingClientRect();
  const t = title ? title.getBoundingClientRect() : null;
  const s = styles ? styles.getBoundingClientRect() : null;
  return {
    btnRight: Math.round(b.right), btnTop: Math.round(b.top), btnW: Math.round(b.width), btnH: Math.round(b.height),
    modalRight: Math.round(m.right), modalTop: Math.round(m.top),
    titleTop: t ? Math.round(t.top) : null,
    stylesTop: s ? Math.round(s.top) : null,
    gapRight: Math.round(m.right - b.right),
  };
});
rec(
  '① 关闭按钮贴在模态右上角',
  !!closeBtn && closeBtn.gapRight <= 16 && closeBtn.btnTop - closeBtn.modalTop <= 60,
  JSON.stringify(closeBtn),
);
rec(
  '① 关闭按钮与标题同行（在风格行上方）',
  !!closeBtn && closeBtn.stylesTop !== null && closeBtn.btnTop < closeBtn.stylesTop && Math.abs(closeBtn.btnTop - (closeBtn.titleTop ?? -999)) <= 24,
  `btnTop=${closeBtn?.btnTop} titleTop=${closeBtn?.titleTop} stylesTop=${closeBtn?.stylesTop}`,
);
rec('① 关闭按钮尺寸够点（≥40px）', !!closeBtn && closeBtn.btnW >= 40 && closeBtn.btnH >= 40, `${closeBtn?.btnW}×${closeBtn?.btnH}`);

/* 未匹配区县：提示卡 + 相册清单 */
await page.evaluate(() => window.__sandboxApp.openPhotoWall({ scope: 'district', id: '330106', title: '西湖区 · 照片墙' }));
await page.waitForTimeout(900);
const tip = await page.evaluate(() => {
  const t = document.querySelector('.wall-media-tip');
  return { exists: !!t, text: t ? t.textContent.slice(0, 140) : '' };
});
rec('④ 未匹配区县显示相册说明卡', tip.exists && /淳安县（3）/.test(tip.text), tip.text.slice(0, 80));
await page.evaluate(() => document.querySelector('.wall-close')?.click());
await page.waitForTimeout(400);

/* ---------- ② ③ 游记编辑器 ---------- */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.place-act--note', { timeout: 8000 });
await page.click('.place-act--note');
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(600);

await page.click('.rt-body');
await page.keyboard.type('千岛湖两日游');
await page.waitForTimeout(300);

// ② 点「＋ 图片」：编辑器应收焦（不弹键盘）
await page.click('.rt-btn--img');
await page.waitForSelector('.np-backdrop', { timeout: 6000 });
await page.waitForTimeout(400);
const focusAfter = await page.evaluate(() => {
  const el = document.activeElement;
  return {
    tag: el?.tagName || '',
    isBody: el === document.body,
    isEditor: !!el && el.classList && el.classList.contains('rt-body'),
  };
});
rec('② 选图后面板不抢焦点、编辑器已收焦（不弹键盘）', !focusAfter.isEditor, JSON.stringify(focusAfter));

const portalOk = await page.evaluate(() => {
  const np = document.querySelector('.np-backdrop');
  return { parentIsBody: np?.parentElement === document.body, inFavPanel: !!np?.closest('.fav-panel') };
});
rec('② 选图面板挂 body（不被截断）', portalOk.parentIsBody && !portalOk.inFavPanel, JSON.stringify(portalOk));

// ③ 工具栏契约
const toolbar = await page.evaluate(() => {
  const tb = document.querySelector('.rt-toolbar');
  const wrap = document.querySelector('.rt-wrap');
  const head = document.querySelector('.note-editor-head');
  const scroll = document.querySelector('.note-editor-scroll');
  if (!tb || !wrap || !head || !scroll) return null;
  const cs = getComputedStyle(tb);
  const wcs = getComputedStyle(wrap);
  return {
    position: cs.position,
    wrapOverflow: `${wcs.overflowX}/${wcs.overflowY}`,
    headInsideScroll: scroll.contains(head),
  };
});
rec('③ 工具栏 position: sticky', toolbar?.position === 'sticky', JSON.stringify(toolbar));
rec('③ 工具栏外层无 overflow 陷阱', !!toolbar && !/hidden|clip/.test(toolbar.wrapOverflow), toolbar?.wrapOverflow);
rec('③ 编辑器头部在滚动区外（键盘弹出仍在）', toolbar && !toolbar.headInsideScroll, String(toolbar?.headInsideScroll));

// ③ 滚到底后工具栏仍钉在滚动区顶部可见（模拟正文上滚）
const scrolled = await page.evaluate(async () => {
  const s = document.querySelector('.note-editor-scroll');
  s.scrollTop = s.scrollHeight;
  await new Promise((r) => setTimeout(r, 350));
  const tb = document.querySelector('.rt-toolbar').getBoundingClientRect();
  const sc = s.getBoundingClientRect();
  return { tbTop: Math.round(tb.top), tbBottom: Math.round(tb.bottom), scTop: Math.round(sc.top), visible: tb.bottom > sc.top && tb.top < sc.bottom };
});
rec('③ 正文滚到底后工具栏仍可见可点', scrolled.visible, JSON.stringify(scrolled));
await page.screenshot({ path: path.join(OUT, 'v14-editor.png') });

// 收起来，再点「总览」测 ⑤
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const back = [...document.querySelectorAll('.ghost-btn')].find((b) => /返回列表/.test(b.textContent || ''));
  back?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /总览/.test(x.textContent || ''));
  b?.click();
});
await page.waitForTimeout(2800);
const mapOverview = await measureMap();
rec('⑤ 总览同样撑满（≥50%）', mapOverview.fillH >= 0.5, `fillH=${mapOverview.fillH} fillW=${mapOverview.fillW}`);
await page.screenshot({ path: path.join(OUT, 'v14-map-overview.png') });

console.log('\npageerrors:', errs.length ? errs : '（无）');
const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
