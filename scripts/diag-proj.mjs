import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2600);
await page.evaluate(() => window.__sandboxApp.focusCityById('330100'));
await page.waitForTimeout(3200);

const info = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const first = [...s.districts.entries()][0];
  const rec = first[1];
  const mesh = rec.meshes[0];
  const w = mesh.position.clone();
  w.set(rec.centroid[0], rec.height, -rec.centroid[1]);
  mesh.localToWorld(w);
  const ndc = w.clone().project(cam);
  const grp = s.districtGroup;
  return {
    camPos: cam.position.toArray().map((v) => +v.toFixed(1)),
    target: s.controls.target.toArray().map((v) => +v.toFixed(1)),
    center: rec.centroid,
    height: rec.height,
    world: w.toArray().map((v) => +v.toFixed(1)),
    ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(2)],
    meshPos: mesh.position.toArray().map((v) => +v.toFixed(1)),
    grpPos: grp.position.toArray().map((v) => +v.toFixed(1)),
    grpVisible: grp.visible,
    cityGrpVisible: s.cityGroup.visible,
    canvas: [s.renderer.domElement.clientWidth, s.renderer.domElement.clientHeight],
    paused: s.paused,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
