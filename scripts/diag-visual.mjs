// 可视化诊断：区县边界是否可见 + 收藏/去过标记是否出现
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror:' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1800);

// 进入杭州
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(2600);
await page.screenshot({ path: path.join(OUT, 'check-city-borders.png') });

// 边界线材质/几何状态
const edgeInfo = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const recs = [...scene.districts.values()];
  const r = recs.find((x) => x.edgeMaterials && x.edgeMaterials.length);
  const m = r.edgeMaterials[0];
  const mesh = r.meshes[0];
  mesh.geometry.computeBoundingBox();
  const line = mesh.children.find((c) => c.type === 'LineLoop');
  line.geometry.computeBoundingBox();
  return {
    count: recs.length,
    edgeColor: '#' + m.color.getHexString(),
    edgeOpacity: m.opacity,
    edgeVisible: m.visible,
    lineZ: +line.geometry.boundingBox.max.z.toFixed(3),
    capZ: +mesh.geometry.boundingBox.max.z.toFixed(3),
    lineCount: line.geometry.attributes.position.count,
  };
});
console.log('EDGE', JSON.stringify(edgeInfo));

// 打开淳安抽屉 → 收藏 + 去过
await page.evaluate(() => window.__sandboxApp.selectDistrictById('330127'));
await page.waitForTimeout(1600);
const clicked = await page.evaluate(() => {
  const fav = document.querySelector('.icon-btn--fav');
  const vis = document.querySelector('.icon-btn--visited');
  fav && fav.click();
  vis && vis.click();
  return { fav: !!fav, vis: !!vis };
});
await page.waitForTimeout(900);
// 关抽屉
await page.evaluate(() => {
  const closeBtn = document.querySelector('.drawer-head .icon-btn:not(.icon-btn--fav):not(.icon-btn--visited)');
  closeBtn && closeBtn.click();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, 'check-markers.png') });

const markerInfo = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const g = scene.districtMarkerGroup;
  const cam = scene.camera;
  const el = scene.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const v = cam.position.clone();
  const proj = (p) => {
    v.copy(p).project(cam);
    return { x: Math.round((v.x * 0.5 + 0.5) * W), y: Math.round((-v.y * 0.5 + 0.5) * H), z: v.z };
  };
  scene.scene.updateMatrixWorld(true);
  const items = g.children.map((c) => {
    const wp = c.getWorldPosition(cam.position.clone());
    return {
      plateId: c.userData.plateId,
      visible: c.visible,
      scale: +c.scale.x.toFixed(3),
      world: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
      screen: proj(wp),
      kind: c.children.map((k) => k.type),
    };
  });
  return {
    groupVisible: g.visible,
    count: g.children.length,
    items,
    viewport: { W, H },
  };
});
console.log('MARKERS', JSON.stringify(markerInfo));

// 让去过/收藏持久化，供刷新后复现
const persisted = await page.evaluate(() => ({
  fav: JSON.parse(localStorage.getItem('ds.favorites.v1') || '{}'),
  visited: JSON.parse(localStorage.getItem('ds.cityStatus.v1') || '{}'),
}));
console.log('PERSIST', JSON.stringify(persisted));

console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none');
await browser.close();
