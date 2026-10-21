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

async function box() {
  return page.evaluate(() => {
    const s = window.__sandboxScene;
    const cam = s.camera;
    const el = s.renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [, rec] of s.districts.entries()) {
      for (const mesh of rec.meshes) {
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const p = cam.position.clone();
          p.set(x, y, z);
          mesh.localToWorld(p);
          const q = p.clone().project(cam);
          const sx = (q.x * 0.5 + 0.5) * W;
          const sy = (-q.y * 0.5 + 0.5) * H;
          minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        }
      }
    }
    // 可见区域：左侧索引 + 右侧城市面板会遮住画面
    const left = document.querySelector('.left-index');
    const right = document.querySelector('.city-panel');
    const lr = left ? left.getBoundingClientRect() : null;
    const rr = right ? right.getBoundingClientRect() : null;
    return {
      W, H,
      minX: Math.round(minX), maxX: Math.round(maxX), minY: Math.round(minY), maxY: Math.round(maxY),
      w: Math.round(maxX - minX), h: Math.round(maxY - minY),
      free: [lr ? Math.round(lr.right) : 0, rr ? Math.round(rr.left) : W],
    };
  });
}

for (const city of ['330100', '310000']) {
  await page.evaluate((id) => window.__sandboxApp.focusCityById(id), city);
  await page.waitForTimeout(3000);
  const b = await box();
  const freeW = b.free[1] - b.free[0];
  console.log(city, JSON.stringify(b),
    '占全屏 w=', (b.w / b.W).toFixed(2), 'h=', (b.h / b.H).toFixed(2),
    '| 占可见区 w=', (b.w / freeW).toFixed(2),
    '| 水平居中偏差=', Math.round(((b.minX + b.maxX) / 2 - (b.free[0] + b.free[1]) / 2)));
}
await browser.close();
