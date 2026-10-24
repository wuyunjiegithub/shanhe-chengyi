/**
 * 回归：① 首屏取景是不是变大了 ② 桌面端右侧有面板时仍要让位 ③ 标记是否贴地
 */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import path from 'node:path';

const URL = process.env.REG_URL || 'http://localhost:1420/';
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

const SEED = () => {
  localStorage.setItem(
    'ds.cityStatus.v1',
    JSON.stringify({ visited: ['330100'], visitedDistricts: ['330106', '330122'] }),
  );
  localStorage.setItem(
    'ds.favorites.v1',
    JSON.stringify({ cities: ['320500'], districts: ['330110', '330127'], spots: [] }),
  );
  localStorage.setItem('ds.layers.v1', JSON.stringify({ terrain: true, weather: false }));
};

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: W, height: H } });
pc.on('pageerror', (e) => console.log('[pc]', String(e).slice(0, 120)));
await pc.addInitScript(SEED);
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(9000);

/* ① 首屏取景：把世界尺寸换算成屏幕像素（相机 fov 48，容器高 900） */
const FOV = 48;
const pxPerUnit = (dist) => H / (2 * Math.tan(((FOV / 2) * Math.PI) / 180) * dist);
const boot = await pc.evaluate(() => window.__sandboxApp.lastFrame());
await pc.screenshot({ path: path.join(OUT, 'mf-boot.png') });
const usableNow = { w: W - 234 - 18, h: H - 70 - 64 };
console.log('  首屏 lastFrame:', JSON.stringify(boot));
// 旧版（v0.9.24）基线：factor 1.08 + 上下预留 88/76 → dist 178
rec('首屏相机比 v0.9.24 更近（地图更大）', boot.dist < 126, `dist=${boot.dist.toFixed(1)} < 126`);

/* 用真实相机投影量屏幕占位：俯视 50° 会压缩远端、放大近端，
   拿世界尺寸乘 px/单位 是算不准的 */
const ext = await pc.evaluate(() => window.__sandboxApp.screenExtent());
console.log('  首屏屏幕占位:', JSON.stringify(ext));
console.log('  相机:', JSON.stringify(await pc.evaluate(() => window.__sandboxApp.debugCamera())));
const ew = ext.x1 - ext.x0;
const eh = ext.y1 - ext.y0;
// 首屏允许「轻微裁边」换更大的地图：每边最多溢出可用区的 3%（factor 0.96）
const TOL = 0.03;
rec(
  '首屏地图裁边不超过可用区的 3%（真实投影）',
  ext.x0 >= 234 - usableNow.w * TOL &&
    ext.y0 >= 70 - usableNow.h * TOL &&
    ext.x1 <= W - 18 + usableNow.w * TOL &&
    ext.y1 <= H - 64 + usableNow.h * TOL,
  `${ext.x0},${ext.y0} → ${ext.x1},${ext.y1}（可用区 234,70 → ${W - 18},${H - 64}）`,
);
rec(
  '首屏地图铺满可用区（至少一个方向 ≥ 98%）',
  ew / usableNow.w > 0.98 || eh / usableNow.h > 0.98,
  `w占比=${(ew / usableNow.w).toFixed(2)} h占比=${(eh / usableNow.h).toFixed(2)}（${ew.toFixed(0)}x${eh.toFixed(0)} / ${usableNow.w}x${usableNow.h}）`,
);

/* 地图不能钻到顶栏 / 底栏底下：用板块标签的实际位置核对 */
const labelBox = await pc.evaluate(() => {
  const els = [...document.querySelectorAll('.geo-label')];
  if (!els.length) return null;
  let y0 = 1e9;
  let y1 = -1e9;
  let x1 = -1e9;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    y0 = Math.min(y0, r.top);
    y1 = Math.max(y1, r.bottom);
    x1 = Math.max(x1, r.right);
  }
  return { y0: Math.round(y0), y1: Math.round(y1), x1: Math.round(x1), n: els.length };
});
console.log('  板块标签范围:', JSON.stringify(labelBox));
if (labelBox) {
  rec('首屏地图未被顶栏压住', labelBox.y0 >= 52, `最上标签 y=${labelBox.y0} ≥ 52`);
  rec('首屏地图未被底栏压住', labelBox.y1 <= H - 48, `最下标签 y=${labelBox.y1} ≤ ${H - 48}`);
  rec('首屏地图未超出右边缘', labelBox.x1 <= W - 8, `最右标签 x=${labelBox.x1} ≤ ${W - 8}`);
}

/* ② 下钻城市：右侧有面板时要让位，地图不能被面板压住 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2800);
const city = await pc.evaluate(() => window.__sandboxApp.lastFrame());
await pc.screenshot({ path: path.join(OUT, 'mf-city.png') });
const cityExt = await pc.evaluate(() => window.__sandboxApp.screenExtent());
console.log('  城市屏占位:', JSON.stringify(cityExt));
rec(
  '下钻城市后地图让出右侧面板位置',
  cityExt.x0 >= 234 - 2 && cityExt.x1 <= W - 372 + 2 && cityExt.y0 >= 70 - 2 && cityExt.y1 <= H - 64 + 2,
  `${cityExt.x0},${cityExt.y0} → ${cityExt.x1},${cityExt.y1}（面板左缘 ${W - 372}）`,
);
/* 区县层：带余量的取景（factor 1.45）不能被收紧到贴边，且要避开右侧抽屉 */
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('330106'));
await pc.waitForTimeout(2800);
const dExt = await pc.evaluate(() => window.__sandboxApp.screenExtent());
console.log('  区县屏占位:', JSON.stringify(dExt));
rec(
  '下钻区县后地图让出右侧抽屉位置',
  dExt.x0 >= 234 - 2 && dExt.x1 <= W - 372 + 2 && dExt.y0 >= 70 - 2 && dExt.y1 <= H - 64 + 2,
  `${dExt.x0},${dExt.y0} → ${dExt.x1},${dExt.y1}`,
);

/* ③ 回到总览：重新用满宽度 */
await pc.evaluate(() => window.__sandboxApp.backToRegion());
await pc.waitForTimeout(2600);
const back = await pc.evaluate(() => window.__sandboxApp.lastFrame());
rec(
  '回到总览后恢复大取景',
  Math.abs(back.dist - boot.dist) < Math.max(2, boot.dist * 0.06),
  `dist=${back.dist.toFixed(1)} vs 首屏 ${boot.dist.toFixed(1)}`,
);

/* ④ 标记贴地：裁图目视 + 贴图空隙断言 */
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(2800);
const labels = await pc.evaluate(() =>
  [...document.querySelectorAll('.geo-label--district')].map((el) => {
    const r = el.getBoundingClientRect();
    return { name: el.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }),
);
for (const t of ['西湖区', '余杭区']) {
  const l = labels.find((x) => x.name === t);
  if (!l) continue;
  await pc.screenshot({
    path: path.join(OUT, `mf-mk-${t}.png`),
    clip: { x: Math.max(0, l.x - 110), y: Math.max(0, l.y - 150), width: 240, height: 240 },
  });
}
const art = await pc.evaluate(async () => {
  const mod = await import('/src/scene/markerArt.ts');
  const gap = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let bottom = -1;
    for (let y = cv.height - 1; y >= 0; y--) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 40) return cv.height - 1 - y;
      }
    }
    return cv.height;
  };
  const out = {};
  for (const s of ['flag', 'pin', 'stamp', 'footprint']) {
    out[s] = { gap: gap(mod.renderMarkerCanvas('visited', s)), px: mod.VISITED_SCREEN_PX[s] };
  }
  out.heart = { gap: gap(mod.renderMarkerCanvas('favorite', 'flag')), px: mod.FAVORITE_SCREEN_PX };
  return out;
});
for (const [k, v] of Object.entries(art)) {
  rec(
    `${k} 贴地下沿空隙 < 2px`,
    (v.gap / 168) * v.px < 2,
    `空隙 ${v.gap}px 画布 → 屏幕 ${((v.gap / 168) * v.px).toFixed(2)}px`,
  );
}

/* ⑤ 标记贴地（世界坐标）：省 / 市 / 区县三级都不能悬空 */
/** 量一页上所有可见标记「底边 − 脚下地表」的屏幕间距，正数 = 悬空 */
const probe = async (page) => page.evaluate(() => window.__sandboxApp.markerProbe());
const checkFloat = (label, list, tol = 2.5) => {
  if (!list.length) {
    rec(`${label}：有可见标记`, false, 'markerProbe 返回空');
    return;
  }
  const worst = list.reduce((a, b) => (Math.abs(b.gapSurfacePx) > Math.abs(a.gapSurfacePx) ? b : a));
  rec(
    `${label}：标记贴地（最差 ${worst.gapSurfacePx}px）`,
    worst.gapSurfacePx <= tol && worst.gapSurfacePx >= -tol,
    `${list.length} 个 · 最差 ${worst.id}/${worst.kind} 底边=${worst.bottomWorld} 地表=${Math.max(
      worst.plateTop,
      worst.terrainY,
    ).toFixed(2)}`,
  );
};
await pc.evaluate(() => window.__sandboxApp.backToRegion());
await pc.waitForTimeout(2600);
checkFloat('省视角（城市标记）', await probe(pc));
await pc.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await pc.waitForTimeout(3200);
checkFloat('市视角（区县标记）', await probe(pc));
await pc.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await pc.waitForTimeout(3200);
checkFloat('区县选中（板块抬起）', await probe(pc));
await pc.screenshot({ path: path.join(OUT, 'mf-marker-district.png') });

/* 关掉地形也要贴地：这时落点回落成板块顶面（局部厚度），同样不能多抬 */
const noT = await browser.newPage({ viewport: { width: W, height: H } });
await noT.addInitScript(() => {
  localStorage.setItem(
    'ds.cityStatus.v1',
    JSON.stringify({ visited: ['330100'], visitedDistricts: ['330106'] }),
  );
  localStorage.setItem(
    'ds.favorites.v1',
    JSON.stringify({ cities: ['320500'], districts: ['330127'], spots: [] }),
  );
  localStorage.setItem('ds.layers.v1', JSON.stringify({ terrain: false, weather: false }));
});
await noT.goto(URL, { waitUntil: 'networkidle' });
await noT.waitForTimeout(6000);
checkFloat('无地形 · 省视角', await probe(noT));
await noT.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await noT.waitForTimeout(3000);
checkFloat('无地形 · 市视角', await probe(noT));
await noT.close();

/* ⑥ 手机竖屏：取景仍保持原来「撑满」的观感（不被新算法放大到把上海切掉） */
const MW = 390;
const MH = 844;
const mb = await browser.newPage({ viewport: { width: MW, height: MH }, hasTouch: true, isMobile: true });
await mb.addInitScript(SEED);
await mb.goto(URL, { waitUntil: 'networkidle' });
await mb.waitForTimeout(8000);
const mf = await mb.evaluate(() => window.__sandboxApp.lastFrame());
const mExt = await mb.evaluate(() => window.__sandboxApp.screenExtent());
console.log('  手机首屏:', JSON.stringify(mf), JSON.stringify(mExt));
rec(
  '手机首屏地图仍占屏高 50%~65%（保持撑满的观感）',
  (mExt.y1 - mExt.y0) / MH > 0.5 && (mExt.y1 - mExt.y0) / MH < 0.65,
  `占屏高=${((mExt.y1 - mExt.y0) / MH).toFixed(2)}`,
);
const sh = await mb.evaluate(() => {
  const el = [...document.querySelectorAll('.geo-label')].find((e) => e.textContent.trim() === '上海市');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 用中心点：标签是带内边距的胶囊，宽度本身就有 100+px，
  // 竖屏本来就允许地图左右出屏（只切到舟山一角），判右缘会误报
  return Math.round(r.left + r.width / 2);
});
rec('手机首屏上海市仍在屏内', sh !== null && sh <= MW - 8, `中心 x=${sh} ≤ ${MW - 8}`);
await mb.screenshot({ path: path.join(OUT, 'mf-mobile-boot.png') });

/* 手机端标记同样不能悬空（区县层用的是同一套 districtMarkerGroup） */
await mb.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await mb.waitForTimeout(3200);
checkFloat('手机 · 市视角（区县标记）', await probe(mb));
await mb.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await mb.waitForTimeout(3200);
checkFloat('手机 · 区县选中', await probe(mb));
await mb.screenshot({ path: path.join(OUT, 'mf-mobile-marker.png') });

await browser.close();
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
