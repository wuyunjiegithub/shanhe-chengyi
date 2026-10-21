import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem('ds.favorites.v1', JSON.stringify({ districts: ['330127'], spots: [], cities: [] }));
  localStorage.setItem('ds.cityStatus.v1', JSON.stringify({ want: [], visited: [], visitedDistricts: ['330127'] }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3000);
// 冻结渲染循环：相机不再漂移，测量与截图对齐
await page.evaluate(() => window.__sandboxScene.setPaused(true));
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const cam = scene.camera;
  const el = scene.renderer.domElement;
  const W = el.clientWidth, H = el.clientHeight;
  const proj = (p) => {
    const v = cam.position.clone().copy(p).project(cam);
    return { x: Math.round((v.x * 0.5 + 0.5) * W), y: Math.round((-v.y * 0.5 + 0.5) * H), z: +v.z.toFixed(3) };
  };
  scene.scene.updateMatrixWorld(true);
  const id = '330127';
  const rec = scene.districts.get(id);
  const label = scene.districtLabelById.get(id);
  return {
    labelScreen: label ? proj(label.position) : null,
    markers: [...scene.districtMarkerGroup.children].map((m) => ({
      plateId: m.userData.plateId,
      screen: proj(m.getWorldPosition(cam.position.clone())),
      scale: +m.scale.x.toFixed(2),
      visible: m.visible,
    })),
    groupVisible: scene.districtMarkerGroup.visible,
  };
});
console.log(JSON.stringify(out));

const ls = out.labelScreen;
const cw = 260, ch = 260;
const cx = Math.max(0, Math.min(1440 - cw, ls.x - cw / 2));
const cy = Math.max(0, Math.min(900 - ch, ls.y - ch / 2));
await page.screenshot({ path: 'regression-shots/debug-normal.png', clip: { x: cx, y: cy, width: cw, height: ch } });
console.log('CROP', JSON.stringify({ cx, cy }));

await browser.close();
