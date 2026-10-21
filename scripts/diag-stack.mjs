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
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const city = s.cities.get('330100');
  const cityInfo = city
    ? {
        y: city.meshes.map((m) => +m.position.y.toFixed(2)),
        visible: city.meshes.map((m) => m.visible),
        height: city.height,
        capHex: city.capMaterials[0].color.getHexString(),
        emissiveIntensity: city.capMaterials[0].emissiveIntensity,
      }
    : null;
  const dRec = [...s.districts.values()][0];
  const distInfo = {
    y: dRec.meshes.map((m) => +m.position.y.toFixed(2)),
    visible: dRec.meshes.map((m) => m.visible),
    height: dRec.height,
    capHex: dRec.capMaterials[0].color.getHexString(),
    emissiveIntensity: dRec.capMaterials[0].emissiveIntensity,
    edgeOpacity: dRec.edgeMaterials[0].opacity,
    edgeHex: dRec.edgeMaterials[0].color.getHexString(),
  };
  // 从相机向某区县质心投射，看谁在最前面
  const world = cam.position.clone();
  world.set(dRec.centroid[0], dRec.height, -dRec.centroid[1]);
  const dir = world.clone().sub(cam.position).normalize();
  const origin = cam.position.clone();
  // 手动求交：沿射线采样，找最近的板块顶面（用包围盒近似不够准，改为遍历 mesh 用 three 的 raycaster）
  const Raycaster = s.__raycasterCtor ?? null;
  return {
    cityInfo,
    distInfo,
    districtGroupY: s.districtGroup.position.y,
    cityGroupY: s.cityGroup.position.y,
    cityGroupVisible: s.cityGroup.visible,
    districtGroupVisible: s.districtGroup.visible,
    layer: s.layer,
    ray: { origin: origin.toArray().map((v) => +v.toFixed(1)), dir: dir.toArray().map((v) => +v.toFixed(2)) },
    hasRaycaster: Boolean(Raycaster),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
