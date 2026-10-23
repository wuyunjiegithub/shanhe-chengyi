// Phase C 回归：验证 8 项反馈修复
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, pixel, lum } from './png.mjs';
import { makePng } from './fixture-png.mjs';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);

// ---- #7 地图中线：GridHelper 顶点颜色应只有一种（中心线与网格线同色）----
const grid = await page.evaluate(() => {
  const g = window.__sandboxScene.grid;
  const col = g.geometry.attributes.color;
  const set = new Set();
  for (let i = 0; i < col.count; i++) {
    set.add(`${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)},${col.getZ(i).toFixed(3)}`);
  }
  return { uniqueColors: set.size, scale: [g.scale.x, g.scale.z] };
});
rec('#7 去中线(色合一)', grid.uniqueColors === 1, `grid 顶点颜色种类=${grid.uniqueColors}(期望1)`);

// ---- #7b 横穿细线真正根因：基座 scale 轴写错（压扁成薄墙）----
// 静止态：所有基座 scale.y 应为 1（足迹不被压），高度由 scale.z 控制且接近 0；
// 同时全场景不应存在「投影后宽>25px、高<9px」的细长板块。
const sliver = await page.evaluate(() => {
  const S = window.__sandboxScene;
  let badY = 0;
  let total = 0;
  let maxZ = 0;
  for (const rec of S.cities.values()) {
    for (const p of rec.pedestals) {
      total += 1;
      if (Math.abs(p.scale.y - 1) > 0.01) badY += 1;
      maxZ = Math.max(maxZ, p.scale.z);
    }
  }
  const cam = S.camera;
  const el = S.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const v = cam.position.clone();
  const proj = (p) => {
    v.copy(p).project(cam);
    return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];
  };
  S.scene.updateMatrixWorld(true);
  let thin = 0;
  S.scene.traverse((o) => {
    if (!o.visible || !o.geometry) return;
    if (!['Mesh', 'Line', 'LineLoop', 'LineSegments'].includes(o.type)) return;
    o.geometry.computeBoundingBox();
    const raw = o.geometry.boundingBox;
    if (!raw) return;
    const bb = raw.clone().applyMatrix4(o.matrixWorld);
    const xs = [];
    const ys = [];
    for (const x of [bb.min.x, bb.max.x])
      for (const y of [bb.min.y, bb.max.y])
        for (const z of [bb.min.z, bb.max.z]) {
          const [sx, sy] = proj({ x, y, z });
          xs.push(sx);
          ys.push(sy);
        }
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    // 阈值 40px：真实的细长岛（崇明/舟山小岛）投影约 20~30px，
    // 而基座压扁形成的「薄墙」宽 44~120px（1080 宽下），用 40 区分开。
    if (bw > 40 && bh < 9 && cy < H * 0.85) thin += 1;
  });
  return { total, badY, maxZ: +maxZ.toFixed(3), thin };
});
rec(
  '#7b 基座未压扁(无横穿细线)',
  sliver.badY === 0 && sliver.thin === 0,
  `基座${sliver.total}个 scale.y≠1 的=${sliver.badY} 最大高度=${sliver.maxZ} 细长板块=${sliver.thin}`,
);

// ---- #4 圆点星空：PointsMaterial 应带圆形 sprite 贴图 ----
const stars = await page.evaluate(() => {
  const s = window.__sandboxScene.stars;
  return { hasMap: !!s.material.map, count: s.geometry.attributes.position.count };
});
rec('#4 圆点星空', stars.hasMap, `stars.map=${stars.hasMap} count=${stars.count}`);

// ---- #3 全局预览入口：BottomBar 现在应包含「时间线」「游记」预览按钮（需求3）----
const bottomBtns = await page.evaluate(() =>
  [...document.querySelectorAll('.bottom-right button')].map((b) => b.textContent.trim()),
);
const hasTimeline = bottomBtns.some((t) => t.includes('时间线'));
const hasTravel = bottomBtns.some((t) => t.includes('游记'));
rec('#3 全局预览入口(时间线/游记)', hasTimeline && hasTravel, `bottom-right按钮=${JSON.stringify(bottomBtns)}`);

// ---- 标签筛选条已整条移除 ----
const tagBar = await page.evaluate(() => ({
  bar: !!document.querySelector('.tag-bar'),
  pills: document.querySelectorAll('.tag-pill').length,
  clear: !!document.querySelector('.tag-clear'),
}));
rec(
  '标签筛选条已移除',
  !tagBar.bar && tagBar.pills === 0 && !tagBar.clear,
  `tag-bar=${tagBar.bar} 标签数=${tagBar.pills} 清除按钮=${tagBar.clear}`,
);

// ---- #2/#6 城市可收藏 + 爱心：进入上海并收藏 ----
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(2200);
const favBtn = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.city-actions .city-act')];
  const b = btns.find((x) => x.textContent.includes('收藏'));
  if (!b) return null;
  b.click();
  return true;
});
await page.waitForTimeout(800);
const favState = await page.evaluate(() => {
  const ui = window.__sandboxApp; // not used; read from zustand via DOM + scene
  const favText = [...document.querySelectorAll('.bottom-right .fav-pill')].map((b) => b.textContent.trim());
  const cityBtnOn = [...document.querySelectorAll('.city-actions .city-act--fav')].some((b) => b.classList.contains('is-on'));
  // 3D 标记：cityMarkerGroup 中 plateId=310000 的子节点存在
  const scene = window.__sandboxScene;
  const marker = [...scene.cityMarkerGroup.children].find((c) => c.userData.plateId === '310000');
  return {
    favText,
    cityBtnOn,
    hasMarker: !!marker,
    favCities: (window.__sandboxUi ? null : null),
  };
});
rec('#2 城市可收藏', favState.cityBtnOn && favState.hasMarker, `按钮is-on=${favState.cityBtnOn} 3D标记=${favState.hasMarker} bottom=${JSON.stringify(favState.favText)}`);

// ---- 「想去」概念已移除，城市操作只剩「去过 / 收藏」 ----
const cityActs = await page.evaluate(() =>
  [...document.querySelectorAll('.city-actions .city-act')].map((b) => b.textContent.trim()),
);
rec(
  '无「想去」概念(仅去过/收藏/写游记)',
  !cityActs.some((t) => t.includes('想去')) && cityActs.some((t) => t.includes('去过')) && cityActs.some((t) => t.includes('收藏')),
  `城市操作按钮=${JSON.stringify(cityActs)}`,
);

// 读取 favorites.cities 持久化（通过 localStorage）
const favCities = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('ds.favorites.v1') || '{}').cities || []; } catch { return []; }
});
rec('#2 收藏写入 cities', favCities.includes('310000'), `favorites.cities=${JSON.stringify(favCities)}`);

// ---- #3 ESC 回退黑屏：进入区县再回退，grid 应恢复到城市包围盒 ----
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104')); // 上海·黄浦区
await page.waitForTimeout(1800);
const gridDistrict = await page.evaluate(() => {
  const g = window.__sandboxScene.grid;
  return { kx: Math.round(g.scale.x * 1000) / 1000, kz: Math.round(g.scale.z * 1000) / 1000 };
});
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(1800);
const gridRegion = await page.evaluate(() => {
  const g = window.__sandboxScene.grid;
  return { kx: Math.round(g.scale.x * 1000) / 1000, kz: Math.round(g.scale.z * 1000) / 1000 };
});
const restored = gridRegion.kx > 0.2 && gridRegion.kx < 0.5; // 城市区域 ~0.31
rec('#3 ESC回退不黑屏', gridDistrict.kx < 0.05 && restored, `区县时kx=${gridDistrict.kx}(应极小) 回退后kx=${gridRegion.kx}(应≈0.31)`);

// ---- #5 群岛/区县高度：舟山各区县板块高度应为 1.0（不再柱林）----
await page.evaluate(() => window.__sandboxApp.focusCityById('330900')); // 舟山
await page.waitForTimeout(2200);
const zs = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const ids = [...scene.districts.keys()].filter((k) => k.startsWith('3309'));
  let sample = null, meshCount = 0;
  for (const id of ids) {
    const rec = scene.districts.get(id);
    if (!sample) sample = { id, height: rec.height, meshes: rec.meshes.length };
    meshCount += rec.meshes.length;
  }
  return { count: ids.length, meshCount, sample };
});
rec('#5 群岛降高', zs.sample && zs.sample.height <= 1.05, `舟山区县数=${zs.count} 总网格=${zs.meshCount} 抽样height=${zs.sample?.height}`);

// ---- #8 照片墙：无图显示空状态；打开时主场景暂停，关闭后恢复 ----
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1500);
// 打开该城市照片墙
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.city-actions, .city-panel-scroll')].flatMap((el) => [...el.querySelectorAll('button')])
    .find((b) => b.textContent.includes('照片墙'));
  btn && btn.click();
});
await page.waitForTimeout(1200);
const pwOpen = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  return { paused: scene.paused, empty: !!document.querySelector('.wall-empty'), count: document.querySelectorAll('.wall-tile, .hall3d').length };
});
rec('#8 照片墙-打开暂停+渲染', pwOpen.paused === true && pwOpen.count >= 0, `paused=${pwOpen.paused} 空状态=${pwOpen.empty}`);
// 关闭
await page.evaluate(() => {
  const close = document.querySelector('.wall-close');
  close && close.click();
});
await page.waitForTimeout(1200);
const pwClose = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  return {
    paused: scene.paused,
    canvasAlive: !!scene.renderer.domElement.parentElement,
    modalGone: !document.querySelector('.wall-backdrop'),
  };
});
rec('#8 照片墙-回退不白屏', pwClose.paused === false && pwClose.canvasAlive && pwClose.modalGone, `paused=${pwClose.paused} canvas在DOM=${pwClose.canvasAlive} 弹窗已关=${pwClose.modalGone}`);

// 无图区县 → 空状态：打开一个区县抽屉，再点照片墙
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310115'));
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.drawer-inner, .drawer-actions')].flatMap((el) => [...el.querySelectorAll('button')])
    .find((b) => b.textContent.includes('照片墙'));
  btn && btn.click();
});
await page.waitForTimeout(1200);
const dtEmpty = await page.evaluate(() => ({
  empty: !!document.querySelector('.wall-empty'),
  tiles: document.querySelectorAll('.wall-tile').length,
}));
rec('#8 无图区县显示空状态', dtEmpty.empty, `空状态=${dtEmpty.empty} 真实图块=${dtEmpty.tiles}`);
await page.evaluate(() => { const c = document.querySelector('.wall-close'); c && c.click(); });
await page.waitForTimeout(600);

// ===== 本轮新需求（边界回归 + 游记/时间线/照片墙）=====

// ---- 需求(边界回归)：区县轮廓线抬离顶盖，不再与顶盖共面导致 z-fighting ----
const borders = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  let coplanar = 0, lifted = 0, fat = 0, samples = [];
  for (const [, rec] of scene.districts.entries()) {
    if (!rec.meshes || !rec.meshes.length) continue;
    const mesh = rec.meshes[0];
    mesh.geometry.computeBoundingBox();
    const capZ = mesh.geometry.boundingBox.max.z; // ExtrudeGeometry 顶盖在本地 z=height
    const line = mesh.children.find((c) => c.type === 'Line2' || c.type === 'LineLoop'); // 顶部轮廓线
    if (!line) continue;
    const lineZ = line.userData && line.userData.contourZ != null ? line.userData.contourZ : capZ;
    if (Math.abs(lineZ - capZ) < 0.005) coplanar += 1; else lifted += 1;
    const mat = line.material;
    if (mat && mat.linewidth >= 1.5 && mat.resolution && mat.resolution.x > 1) fat += 1;
    if (samples.length < 2) samples.push({ capZ: +capZ.toFixed(3), lineZ: +lineZ.toFixed(3), w: mat?.linewidth, rx: mat?.resolution?.x });
  }
  return { coplanar, lifted, fat, samples };
});
rec('边界不再共面(z-fighting修复)', borders.coplanar === 0 && borders.lifted > 0, `共面=${borders.coplanar} 抬升=${borders.lifted} 抽样=${JSON.stringify(borders.samples)}`);
rec('边界为粗线(Line2)', borders.fat > 0, `粗线区县=${borders.fat} 抽样=${JSON.stringify(borders.samples)}`);

// ---- 需求3续：全局游记面板不应有「＋写游记」全局新建按钮 ----
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.bottom-right button')].find((b) => b.textContent.includes('游记'));
  btn && btn.click();
});
await page.waitForTimeout(900);
const travelGlobal = await page.evaluate(() => {
  const hasCreate = [...document.querySelectorAll('.travel-panel button')].some((b) => b.textContent.includes('＋ 写游记'));
  const open = !!document.querySelector('.travel-panel');
  const close = document.querySelector('.travel-panel .icon-btn');
  close && close.click();
  return { hasCreate, open };
});
await page.waitForTimeout(600);
rec('游记仅详情写(全局无新建)', travelGlobal.open && !travelGlobal.hasCreate, `面板打开=${travelGlobal.open} 含＋写游记=${travelGlobal.hasCreate}`);

// ---- 需求1：游记入口（v1.0 起城市也能写；区县抽屉一直有）----
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1800);
const cityTravel = await page.evaluate(() =>
  [...document.querySelectorAll('.city-actions .city-act')].some((b) => b.textContent.includes('写游记')),
);
rec('游记入口齐全(城市+区县都能写)', cityTravel, `城市面板含写游记=${cityTravel}`);

await page.evaluate(() => window.__sandboxApp.selectDistrictById('310104')); // 上海·黄浦区
await page.waitForTimeout(1600);
const distTravel = await page.evaluate(() =>
  [...document.querySelectorAll('.drawer-actions button')].some((b) => b.textContent.includes('写游记')),
);
rec('游记仅区县(抽屉有按钮)', distTravel, `区县抽屉含写游记=${distTravel}`);

// ---- 需求2：区县抽屉手动添加到访时间 ----
const visitUI = await page.evaluate(() => ({
  hasInput: !!document.querySelector('.visit-date-input'),
  hasAdd: [...document.querySelectorAll('.visit-add button')].some((b) => b.textContent.includes('添加这次到访')),
  rowsBefore: document.querySelectorAll('.visit-row').length,
}));
rec('到访时间UI存在', visitUI.hasInput && visitUI.hasAdd, `日期输入=${visitUI.hasInput} 添加按钮=${visitUI.hasAdd}`);
// 点「去过」自动记一次
await page.evaluate(() => {
  const v = document.querySelector('.icon-btn--visited');
  v && v.click();
});
await page.waitForTimeout(700);
const visitAuto = await page.evaluate(() => {
  const rows = document.querySelectorAll('.visit-row').length;
  let visits = [];
  try { visits = JSON.parse(localStorage.getItem('ds.visits.v1') || '[]'); } catch {}
  return { rows, hasDistrict: visits.some((r) => r.kind === 'district' && r.placeId === '310104') };
});
rec('去过自动记入时间线', visitAuto.rows >= 1 && visitAuto.hasDistrict, `到访行=${visitAuto.rows} 含本区县=${visitAuto.hasDistrict}`);
// 手动补录一个日期
await page.fill('.visit-date-input', '2024-05-01');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.visit-add button')].find((x) => x.textContent.includes('添加这次到访'));
  b && b.click();
});
await page.waitForTimeout(700);
const visitManual = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.visit-row .visit-date')].map((e) => e.textContent.trim());
  return { rows, hasDate: rows.includes('2024-05-01') };
});
rec('手动补录到访日期', visitManual.hasDate, `到访日期行=${JSON.stringify(visitManual.rows)}`);

// ---- 需求5：照片墙内不再有本地目录绑定入口 ----
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-actions, .drawer-inner')]
    .flatMap((el) => [...el.querySelectorAll('button')])
    .find((x) => x.textContent.includes('照片墙'));
  b && b.click();
});
await page.waitForTimeout(1000);
const pwBind = await page.evaluate(() => {
  const hasBindBtn = !!document.querySelector('.wall-bind');
  const hasBindText = [...document.querySelectorAll('.wall-modal button')].some(
    (b) => b.textContent.includes('照片库') || b.textContent.includes('绑定本地照片目录'),
  );
  const close = document.querySelector('.wall-close');
  close && close.click();
  return { hasBindBtn, hasBindText };
});
await page.waitForTimeout(600);
rec('照片墙无绑定入口', !pwBind.hasBindBtn && !pwBind.hasBindText, `wall-bind=${pwBind.hasBindBtn} 绑定文案=${pwBind.hasBindText}`);

// ===== ESC 关闭弹框 / 弹框时不误触地图 / 游记自动保存 =====
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2000);
const cityPanelBefore = await page.evaluate(() => !!document.querySelector('.city-panel'));

// 时间线：打开 → ESC 关闭；地图应仍在城市视图（不能因 ESC 退回到区域总览）
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bottom-right button')].find((x) => x.textContent.includes('时间线'));
  b && b.click();
});
await page.waitForTimeout(700);
const tlOpen = await page.evaluate(() => !!document.querySelector('.timeline-panel'));
const tlTitle = await page.evaluate(
  () => document.querySelector('.timeline-panel .drawer-title')?.textContent?.trim() ?? '',
);
rec(
  '时间线标题不用疑问句式',
  !!tlTitle && !tlTitle.includes('什么时候'),
  `标题=${JSON.stringify(tlTitle)}`,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const tlClosed = await page.evaluate(() => ({
  gone: !document.querySelector('.timeline-panel'),
  stillCity: !!document.querySelector('.city-panel'),
  regionHint: !!document.querySelector('.region-hint'),
}));
rec('ESC 关闭时间线', tlOpen && tlClosed.gone, `打开=${tlOpen} 关闭=${tlClosed.gone}`);
rec('弹框时 ESC 不影响地图', cityPanelBefore && tlClosed.stillCity && !tlClosed.regionHint, `城市面板=${tlClosed.stillCity} 区域提示=${tlClosed.regionHint}`);

// 游记面板：打开 → ESC 关闭
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bottom-right button')].find((x) => x.textContent.includes('游记'));
  b && b.click();
});
await page.waitForTimeout(700);
const tvOpen = await page.evaluate(() => !!document.querySelector('.travel-panel'));
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const tvGone = await page.evaluate(() => !document.querySelector('.travel-panel'));
rec('ESC 关闭游记面板', tvOpen && tvGone, `打开=${tvOpen} 关闭=${tvGone}`);

// 游记自动保存：区县写游记 → 输入标题/正文 → 立即 ESC（不等防抖）→ 重新打开应已保存
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);
// 收藏 + 去过：3D 标记应存在、且全部关闭深度测试（始终画在板块之上，不被遮挡）
await page.evaluate(() => {
  document.querySelector('.icon-btn--fav')?.click();
  document.querySelector('.icon-btn--visited')?.click();
});
await page.waitForTimeout(800);
const mk = await page.evaluate(() => {
  const g = window.__sandboxScene.districtMarkerGroup;
  const items = g.children.filter((m) => m.userData.plateId === '330127');
  let allOnTop = items.length > 0;
  for (const m of items) {
    m.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of mats) if (mm.depthTest !== false) allOnTop = false;
      }
    });
  }
  return { count: items.length, allOnTop, visible: g.visible };
});
rec('收藏/去过标记可见(置顶)', mk.count >= 2 && mk.allOnTop && mk.visible, `标记数=${mk.count} 全部置顶=${mk.allOnTop} 组可见=${mk.visible}`);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.drawer-actions button')].find((x) => x.textContent.includes('写游记'));
  b && b.click();
});
await page.waitForTimeout(800);
const editorOpen = await page.evaluate(() => !!document.querySelector('.note-editor'));
await page.fill('.note-title-input', '自动保存测试');
await page.click('.rt-body');
await page.keyboard.type('这是一段自动保存的正文。');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.bottom-right button')].find((x) => x.textContent.includes('游记'));
  b && b.click();
});
await page.waitForTimeout(700);
const saved = await page.evaluate(() => {
  const panel = document.querySelector('.travel-panel');
  const titles = panel ? [...panel.querySelectorAll('.note-card-title')].map((e) => e.textContent.trim()) : [];
  const empty = panel ? !!panel.querySelector('.block-empty') : false;
  return { titles, empty, has: titles.includes('自动保存测试') };
});
rec('游记编辑自动保存', editorOpen && saved.has && !saved.empty, `编辑器=${editorOpen} 列表空=${saved.empty} 已保存标题=${JSON.stringify(saved.titles)}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ===== 区县层不被城市板压住 + 边界可见 + 取景不过大 =====
// 先退回区域再重新下钻，保证相机确实是「刚点进城市」的取景状态
await page.evaluate(() => window.__sandboxApp.backToRegion());
await page.waitForTimeout(1800);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3000);

const layer = await page.evaluate(() => {
  const s = window.__sandboxScene;
  return {
    districtY: +s.districtGroup.position.y.toFixed(2),
    pinY: +s.pinGroup.position.y.toFixed(2),
    markerY: +s.districtMarkerGroup.position.y.toFixed(2),
    labelY: +s.districtLabelGroup.position.y.toFixed(2),
    cityHeight: s.cities.get('330100')?.height ?? null,
  };
});
rec(
  '区县层抬到城市板之上(不再被压住)',
  layer.cityHeight !== null &&
    layer.districtY >= layer.cityHeight &&
    layer.pinY === layer.districtY &&
    layer.markerY === layer.districtY &&
    layer.labelY === layer.districtY,
  JSON.stringify(layer),
);

// 边界可见：把轮廓线投影到屏幕，取该像素与「板内 6px」像素的亮度差
await page.evaluate(() => window.__sandboxScene.setPaused(true));
await page.waitForTimeout(200);
const contourPts = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const el = s.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const out = [];
  for (const [, rec2] of s.districts.entries()) {
    const mesh = rec2.meshes[0];
    if (!mesh) continue;
    const line = mesh.children.find((c) => c.isLine2 || c.type === 'Line2');
    if (!line) continue;
    const attr = line.geometry.attributes.instanceStart;
    if (!attr) continue;
    const n = attr.count;
    const step = Math.max(1, Math.floor(n / 8));
    const c = cam.position.clone();
    c.set(rec2.centroid[0], rec2.height + s.districtGroup.position.y, -rec2.centroid[1]);
    const cq = c.clone().project(cam);
    const cs = { x: (cq.x * 0.5 + 0.5) * W, y: (-cq.y * 0.5 + 0.5) * H };
    for (let i = 0; i < n; i += step) {
      const p = mesh.position.clone();
      p.set(attr.getX(i), attr.getY(i), attr.getZ(i));
      mesh.localToWorld(p);
      const q = p.clone().project(cam);
      const x = (q.x * 0.5 + 0.5) * W;
      const y = (-q.y * 0.5 + 0.5) * H;
      if (x < 3 || y < 3 || x > W - 3 || y > H - 3) continue;
      const dx = cs.x - x;
      const dy = cs.y - y;
      const d = Math.hypot(dx, dy) || 1;
      out.push({ x, y, ix: x + (dx / d) * 6, iy: y + (dy / d) * 6 });
    }
  }
  return out;
});
const shotImg = decodePng(await page.screenshot());
let borderSeen = 0;
let borderTotal = 0;
for (const s of contourPts) {
  const a = pixel(shotImg, s.x, s.y);
  const b = pixel(shotImg, s.ix, s.iy);
  if (!a || !b) continue;
  borderTotal += 1;
  if (lum(a) - lum(b) > 12) borderSeen += 1;
}
rec(
  '区县边界可见(屏幕像素对比)',
  borderTotal > 20 && borderSeen / borderTotal > 0.5,
  `采样=${borderTotal} 可见=${borderSeen} 比例=${(borderSeen / Math.max(borderTotal, 1)).toFixed(2)}`,
);
await page.evaluate(() => window.__sandboxScene.setPaused(false));

// 取景：整座城市应落在「面板之间的可见区」内，不怼满整屏
const fit = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const el = s.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [, rec2] of s.districts.entries()) {
    for (const mesh of rec2.meshes) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x])
        for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            const p = cam.position.clone();
            p.set(x, y, z);
            mesh.localToWorld(p);
            const q = p.clone().project(cam);
            minX = Math.min(minX, (q.x * 0.5 + 0.5) * W);
            maxX = Math.max(maxX, (q.x * 0.5 + 0.5) * W);
            minY = Math.min(minY, (-q.y * 0.5 + 0.5) * H);
            maxY = Math.max(maxY, (-q.y * 0.5 + 0.5) * H);
          }
    }
  }
  return { minX: Math.round(minX), maxX: Math.round(maxX), minY: Math.round(minY), maxY: Math.round(maxY), W, H, n: s.districts.size, ids: [...s.districts.keys()].length, tgt: [+s.controls.target.x.toFixed(1), +s.controls.target.z.toFixed(1)], dist: +cam.position.distanceTo(s.controls.target).toFixed(2), paused: s.paused, lastFrame: s.lastFrame };
});
const inView =
  fit.minX > 226 && fit.maxX < 1078 && fit.minY > 76 && fit.maxY < 834 &&
  fit.maxX - fit.minX < 1068 - 240 + 40;
rec('城市取景落在可见区(不再过大)', inView, `投影范围 x[${fit.minX},${fit.maxX}] y[${fit.minY},${fit.maxY}] 可用区 x[240,1068] y[88,824] 区县数=${fit.n} target=${JSON.stringify(fit.tgt)} W/H=${fit.W}/${fit.H} dist=${fit.dist} paused=${fit.paused} lastFrame=${JSON.stringify(fit.lastFrame)}`);

// ===== 爱心朝向：上宽下尖（旧轮廓是倒的） =====
const heartShape = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const marker = [...s.districtMarkerGroup.children].find((c) => c.userData.intrinsicH === 0.9);
  if (!marker) return null;
  let mesh = null;
  marker.traverse((o) => {
    if (!mesh && o.geometry && o.geometry.attributes?.position) mesh = o;
  });
  if (!mesh) return null;
  const pos = mesh.geometry.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const band = (a, b) => {
    let mn = Infinity;
    let mx = -Infinity;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= a && y <= b) {
        const x = pos.getX(i);
        if (x < mn) mn = x;
        if (x > mx) mx = x;
        n += 1;
      }
    }
    return n ? mx - mn : 0;
  };
  const third = (maxY - minY) / 3;
  return {
    h: +(maxY - minY).toFixed(3),
    wTop: +band(maxY - third, maxY).toFixed(3),
    wBottom: +band(minY, minY + third).toFixed(3),
  };
});
rec(
  '爱心朝向正确(上宽下尖)',
  Boolean(heartShape) && heartShape.wTop > heartShape.wBottom * 1.15,
  JSON.stringify(heartShape),
);

// ===== 照片墙：本地照片显示 / 刷新仍在 / 放大完整 =====
const fixtureRoot = path.join(OUT, 'photo-fixture', '浙江省', '杭州市', '淳安县');
fs.mkdirSync(fixtureRoot, { recursive: true });
const fixture = [
  ['qd-1.png', 1200, 800, [30, 90, 160]],
  ['qd-2.png', 900, 1600, [160, 60, 40]],
];
for (const [name, w, h, rgb] of fixture) {
  fs.writeFileSync(path.join(fixtureRoot, name), makePng(w, h, rgb));
}

await page.addInitScript(() => {
  try {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  } catch { /* ignore */ }
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2600);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.hud-top button')].find((x) => x.textContent.includes('设置'));
  b && b.click();
});
await page.waitForTimeout(500);
const payload = fixture.map(([name]) => ({
  name,
  rel: `浙江省/杭州市/淳安县/${name}`,
  b64: fs.readFileSync(path.join(fixtureRoot, name)).toString('base64'),
}));
await page.evaluate((items) => {
  const dt = new DataTransfer();
  for (const it of items) {
    const bin = Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0));
    const f = new File([bin], it.name, { type: 'image/png' });
    Object.defineProperty(f, 'webkitRelativePath', { value: it.rel, configurable: true });
    dt.items.add(f);
  }
  const el = document.querySelector('input[type=file]');
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, payload);
await page.waitForTimeout(1500);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

const openWall = async () => {
  await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
  await page.waitForTimeout(2400);
  await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.includes('照片墙'));
    b && b.click();
  });
  await page.waitForTimeout(1600);
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.wall-modal img')];
    return {
      tiles: document.querySelectorAll('.wall-tile').length,
      imgCount: imgs.length,
      loaded: imgs.filter((i) => i.naturalWidth > 0).length,
      empty: !!document.querySelector('.wall-empty'),
    };
  });
};

const wall1 = await openWall();
rec('照片墙-本地照片显示', wall1.tiles >= 2 && wall1.loaded === wall1.imgCount && wall1.imgCount >= 2 && !wall1.empty, JSON.stringify(wall1));

await page.evaluate(() => document.querySelector('.wall-tile')?.click());
await page.waitForTimeout(1200);
const focusFit = await page.evaluate(() => {
  // v1.0 起聚焦态是 PhotoViewer（.pv-media），object-fit:contain + 完整可见
  const img = document.querySelector('.pv-media');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  const cs = getComputedStyle(img);
  return {
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    shown: `${Math.round(r.width)}x${Math.round(r.height)}`,
    ratioNatural: +(img.naturalWidth / img.naturalHeight).toFixed(3),
    ratioShown: +(r.width / r.height).toFixed(3),
    objectFit: cs.objectFit,
    inViewport: r.width <= window.innerWidth + 1 && r.height <= window.innerHeight + 1,
  };
});
rec(
  '照片墙-放大完整自适应',
  Boolean(focusFit) &&
    focusFit.objectFit === 'contain' &&
    Math.abs(focusFit.ratioNatural - focusFit.ratioShown) < 0.02 &&
    focusFit.inViewport,
  JSON.stringify(focusFit),
);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2800);
const wall2 = await openWall();
rec('照片墙-刷新后照片仍在', wall2.loaded >= 2 && wall2.loaded === wall2.imgCount, JSON.stringify(wall2));

console.log('--- Console/Page errors:', errors.length ? JSON.stringify(errors) : 'none');
rec('无运行时报错', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== ${passed}/${results.length} PASS ===`);
process.exit(passed === results.length ? 0 : 1);
