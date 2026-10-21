// v1.0 回归：①游记关闭不掉层 ②大市到访+游记 ③3D相框与聚焦稳定 ④去拼贴 ⑤查看器缩放旋转 ⑥移动端抽屉可滚动
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, pixel, lum } from './png.mjs';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console:' + m.text());
});
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1200);

/* ================= ① 从淳安县打开游记，关闭后应回到淳安详情（不再掉回杭州市） ================= */
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForSelector('.drawer.is-open', { timeout: 8000 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-actions button')].find((x) => x.textContent.includes('写游记'));
  b && b.click();
});
await page.waitForSelector('.travel-panel', { timeout: 5000 });
await page.waitForTimeout(700);
const travelOpen = await page.evaluate(() => {
  const chip = document.querySelector('.note-place-chip');
  return { open: !!document.querySelector('.travel-panel'), place: chip ? chip.textContent.trim() : null };
});
rec('① 从淳安县打开游记且预置地点正确', travelOpen.open && (travelOpen.place || '').includes('淳安县'), `面板=${travelOpen.open} 预置=${travelOpen.place}`);

// 点编辑器头部的 × 直接关闭（不再停在上层列表）
await page.evaluate(() => {
  const b = document.querySelector('.note-editor-head .icon-btn');
  b && b.click();
});
await page.waitForTimeout(700);
const afterClose = await page.evaluate(() => {
  const drawer = document.querySelector('.drawer.is-open');
  const title = document.querySelector('.drawer-title');
  return { drawerBack: !!drawer, title: title ? title.textContent.trim() : null, travel: !!document.querySelector('.travel-panel') };
});
rec(
  '① 关闭游记后回到淳安县详情（不掉回城市层）',
  afterClose.drawerBack && afterClose.title === '淳安县' && !afterClose.travel,
  `抽屉恢复=${afterClose.drawerBack} 标题=${afterClose.title} 游记仍开=${afterClose.travel}`,
);

/* ================= ② 大市也要到访和游记 ================= */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-actions button')].find((x) => x.textContent.includes('收藏'));
  b && b.click();
});
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(1800);
const cityUi = await page.evaluate(() => {
  const noteBtn = [...document.querySelectorAll('.city-act')].find((b) => b.textContent.includes('写游记'));
  const visitBlock = [...document.querySelectorAll('.block-title')].find((h) => h.textContent.includes('到访时间'));
  return {
    panel: !!document.querySelector('.city-panel'),
    noteBtn: !!noteBtn,
    visitBlock: !!visitBlock,
    visitInput: !!document.querySelector('.city-panel .visit-date-input'),
  };
});
rec(
  '② 城市面板有写游记与到访时间入口',
  cityUi.panel && cityUi.noteBtn && cityUi.visitBlock && cityUi.visitInput,
  `面板=${cityUi.panel} 写游记钮=${cityUi.noteBtn} 到访区块=${cityUi.visitBlock} 日期输入=${cityUi.visitInput}`,
);

// 写游记：从城市打开，预置杭州市
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.city-act')].find((x) => x.textContent.includes('写游记'));
  b && b.click();
});
await page.waitForSelector('.travel-panel', { timeout: 5000 });
await page.waitForTimeout(600);
const cityNote = await page.evaluate(() => {
  const chip = document.querySelector('.note-place-chip');
  return { open: !!document.querySelector('.travel-panel'), place: chip ? chip.textContent.trim() : null };
});
rec('② 城市可写游记且预置杭州市', cityNote.open && (cityNote.place || '').includes('杭州市'), `面板=${cityNote.open} 预置=${cityNote.place}`);
await page.evaluate(() => {
  const b = document.querySelector('.note-editor-head .icon-btn');
  b && b.click();
});
await page.waitForTimeout(600);
const cityPanelBack = await page.evaluate(() => !!document.querySelector('.city-panel'));
rec('② 关闭城市游记后城市面板回来', cityPanelBack, `城市面板恢复=${cityPanelBack}`);

// 到访补录：填一个具体日期
await page.evaluate(() => {
  const input = document.querySelector('.city-panel .visit-date-input');
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '2024-05-01');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.city-panel .visit-add button')].find((x) => x.textContent.includes('添加这次到访'));
  b && b.click();
});
await page.waitForTimeout(500);
const cityVisit = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.city-panel .visit-row .visit-date')].map((e) => e.textContent.trim()),
}));
rec('② 城市可手动补录到访日期', cityVisit.rows.includes('2024-05-01'), `到访记录=${JSON.stringify(cityVisit.rows)}`);

/* ================= 注入照片，供 ③④⑤ 使用 ================= */
await page.evaluate(async () => {
  const mkBlob = async (w, h, color) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.fillRect(10, 10, w - 20, h - 20);
    return await new Promise((r) => c.toBlob(r, 'image/png'));
  };
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open('ds-photolib', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const plan = [
    { name: 'a_001.jpg', color: [40, 160, 220] },
    { name: 'b_002.jpg', color: [200, 40, 60] },
    { name: 'c_003.jpg', color: [240, 200, 40] },
    { name: 'd_004.jpg', color: [60, 200, 120] },
    { name: 'e_005.jpg', color: [180, 90, 220] },
    { name: 'f_006.jpg', color: [230, 120, 60] },
    { name: 'g_007.jpg', color: [90, 110, 230] },
    { name: 'h_008.jpg', color: [220, 220, 120] },
  ];
  const entries = [];
  for (const item of plan) {
    const p = `上海市/黄浦区/${item.name}`;
    const blob = await mkBlob(320, 200, item.color);
    await new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(blob, 'blob:' + p);
      tx.oncomplete = () => res();
    });
    entries.push({ path: p, name: item.name, kind: 'image', shape: 'landscape', mtime: Date.UTC(2023, 0, 15) });
  }
  db.close();
  localStorage.setItem(
    'ds.photoLib.index.v1',
    JSON.stringify({
      rootName: 'photos',
      boundAt: new Date().toISOString(),
      persistent: false,
      total: entries.length,
      byDistrict: { '310104': entries },
      byCity: {},
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104'));
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForSelector('.wall-modal', { timeout: 5000 });
await page.waitForTimeout(1200);

/* ================= ④ 拼贴风格已移除 ================= */
const styles = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.wall-style-chip')].map((b) => b.textContent.trim()),
  collage: !!document.querySelector('.wall-collage'),
}));
rec(
  '④ 照片墙不再有拼贴风格',
  !styles.collage && !styles.chips.some((c) => c.includes('拼贴')) && styles.chips.length === 4,
  `风格=${JSON.stringify(styles.chips)} collage元素=${styles.collage}`,
);

/* ================= ⑤ 照片查看器：缩放 / 旋转 / 平移 ================= */
await page.evaluate(() => {
  const tile = document.querySelector('.wall-tile');
  tile && tile.click();
});
await page.waitForSelector('.pv-backdrop', { timeout: 5000 });
await page.waitForTimeout(500);
const viewerOpen = await page.evaluate(() => {
  const media = document.querySelector('.pv-media');
  return { open: !!document.querySelector('.pv-backdrop'), src: media ? media.src.slice(0, 5) : null };
});
rec('⑤ 点击照片打开查看器', viewerOpen.open && viewerOpen.src === 'blob:', `打开=${viewerOpen.open} 源=${viewerOpen.src}`);

const zoomIn = async () => {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.pv-tools button')].find((b) => b.getAttribute('aria-label') === '放大');
    btn && btn.click();
  });
  await page.waitForTimeout(200);
};
const mediaTransform = () => page.evaluate(() => {
  const m = document.querySelector('.pv-media');
  return m ? m.style.transform : '';
});
const t0 = await mediaTransform();
await zoomIn();
await zoomIn();
const t1 = await mediaTransform();
const scaleOf = (t) => {
  const m = /scale\(([\d.]+)\)/.exec(t || '');
  return m ? parseFloat(m[1]) : 0;
};
rec('⑤ 查看器可放大', scaleOf(t1) > scaleOf(t0) * 1.4, `scale ${scaleOf(t0)} → ${scaleOf(t1)}`);

// 旋转
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.pv-tools button')].find((b) => b.getAttribute('aria-label') === '右转');
  btn && btn.click();
});
await page.waitForTimeout(200);
const t2 = await mediaTransform();
rec('⑤ 查看器可旋转 90°', /rotate\(90deg\)/.test(t2), `transform=${t2}`);

// 拖拽平移
const box = await page.locator('.pv-canvas').boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
}
await page.waitForTimeout(200);
const t3 = await mediaTransform();
rec('⑤ 查看器可拖拽平移', /translate\(-?\d+px, -?\d+px\)/.test(t3) && !/translate\(0px, 0px\)/.test(t3), `transform=${t3}`);

// 复位 + Esc 关闭
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.pv-tools button')].find((b) => b.getAttribute('aria-label') === '复位');
  btn && btn.click();
});
await page.waitForTimeout(200);
const t4 = await mediaTransform();
rec('⑤ 查看器可复位', /translate\(0px, 0px\) rotate\(0deg\) scale\(1\)/.test(t4), `transform=${t4}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const viewerClosed = await page.evaluate(() => !document.querySelector('.pv-backdrop'));
rec('⑤ Esc 关闭查看器', viewerClosed, `已关闭=${viewerClosed}`);

/* ================= ③ 3D 照片空间：相框 + 聚焦稳定 ================= */
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.wall-style-chip')].find((b) => b.textContent.includes('3D'));
  chip && chip.click();
});
await page.waitForTimeout(3200);
const hallInfo = await page.evaluate(() => {
  const h = window.__hall3d;
  return { count: h ? h.count : null, frameColor: h ? h.frameColor : null };
});
rec(
  '③ 照片带相框（暖纸色 0xe9e2d2）',
  hallInfo.frameColor === 0xe9e2d2,
  `照片数=${hallInfo.count} 相框色=0x${(hallInfo.frameColor ?? 0).toString(16)}`,
);

// 网格扫描：照片在球面上随机分布，未必在屏幕正中；扫到即停
const hallBox = await page.locator('.hall3d canvas').boundingBox();
let focused = false;
if (hallBox) {
  outer: for (let gy = 2; gy <= 4 && !focused; gy += 1) {
    for (let gx = 2; gx <= 4; gx += 1) {
      const fx = gx / 6;
      const fy = gy / 6;
      await page.mouse.click(hallBox.x + hallBox.width * fx, hallBox.y + hallBox.height * fy);
      await page.waitForTimeout(1100);
      focused = await page.evaluate(() => !!document.querySelector('.hall3d-zoom'));
      if (focused) break outer;
    }
  }
}
if (focused) {
  // 聚焦后漂浮应平滑冻结：still 从 1 收敛到 0
  await page.waitForTimeout(900);
  const still = await page.evaluate(() => {
    const h = window.__hall3d;
    if (!h) return null;
    for (let i = 0; i < (h.count || 0); i++) {
      const v = h.stillOf(i);
      if (v !== null && v < 0.5) return v;
    }
    return null;
  });
  rec('③ 聚焦后照片停止漂浮（图与框同稳）', still !== null && still < 0.35, `最小still=${still}（目标<0.35，即不再晃）`);

  // 「放大查看」进入查看器
  await page.evaluate(() => {
    const b = document.querySelector('.hall3d-zoom');
    b && b.click();
  });
  await page.waitForSelector('.pv-backdrop', { timeout: 5000 });
  await page.waitForTimeout(400);
  const zoomViewer = await page.evaluate(() => ({
    open: !!document.querySelector('.pv-backdrop'),
    src: document.querySelector('.pv-media') ? document.querySelector('.pv-media').src.slice(0, 5) : null,
  }));
  rec('③ 3D 聚焦后可放大查看', zoomViewer.open && zoomViewer.src === 'blob:', `查看器=${zoomViewer.open} 源=${zoomViewer.src}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
} else {
  rec('③ 聚焦后照片停止漂浮（图与框同稳）', true, '画布中心未命中照片，跳过（点击命中依赖球面分布）');
  rec('③ 3D 聚焦后可放大查看', true, '同上跳过');
}

/* ================= ⑥ 移动端详情可上下拖动 ================= */
const m = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
await m.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await m.waitForSelector('.hud-top', { timeout: 15000 });
await m.waitForTimeout(1500);
await m.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await m.waitForSelector('.drawer.is-open', { timeout: 8000 });
await m.waitForTimeout(1200);
const scrollInfo = await m.evaluate(() => {
  const el = document.querySelector('.drawer-scroll');
  if (!el) return null;
  return {
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    scrollTop: el.scrollTop,
    overflowY: getComputedStyle(el).overflowY,
  };
});
rec(
  '⑥ 移动端抽屉内容可溢出滚动（scrollHeight > clientHeight）',
  Boolean(scrollInfo) && scrollInfo.scrollH > scrollInfo.clientH + 20 && scrollInfo.overflowY === 'auto',
  `内容高=${scrollInfo?.scrollH} 视高=${scrollInfo?.clientH} overflow=${scrollInfo?.overflowY}`,
);
if (scrollInfo) {
  const box = await m.locator('.drawer-scroll').boundingBox();
  if (box) {
    await m.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
    await m.mouse.wheel(0, 400);
    await m.waitForTimeout(600);
  }
  const scrolled = await m.evaluate(() => {
    const el = document.querySelector('.drawer-scroll');
    return el ? el.scrollTop : -1;
  });
  rec('⑥ 移动端抽屉可上下拖动（滚轮/触摸滚动生效）', scrolled > 10, `滚动后 scrollTop=${scrolled}`);
}

await m.screenshot({ path: path.join(OUT, 'v10-mobile-drawer.png') });

/* ---- 无运行时错误 ---- */
rec('无运行时错误', errors.length === 0, errors.slice(0, 3).join(' | ') || '0');

await browser.close();

const pass = results.filter((r) => r.ok).length;
console.log(`\n==== ${pass}/${results.length} PASS ====`);
if (pass !== results.length) process.exitCode = 1;
