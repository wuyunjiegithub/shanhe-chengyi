// 诊断：找出地图中部「横穿细线」到底是哪个对象
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1800);

// 固定到默认俯视
await page.evaluate(() => window.__sandboxApp.resetCamera());
await page.waitForTimeout(1600);

const info = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const cam = S.camera;
  const el = S.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  cam.updateMatrixWorld(true);

  const describe = (o) => {
    const chain = [];
    let p = o;
    for (let i = 0; i < 4 && p; i++) {
      const ud = p.userData || {};
      chain.push({
        type: p.type,
        geom: p.geometry?.type,
        color: p.material
          ? Array.isArray(p.material)
            ? p.material.map((m) => '#' + m.color?.getHexString())
            : '#' + p.material.color?.getHexString()
          : undefined,
        id: ud.id,
        name: ud.name,
        kind: ud.kind,
      });
      p = p.parent;
    }
    return chain;
  };

  const probe = (px, py) => {
    const nx = (px / W) * 2 - 1;
    const ny = -(py / H) * 2 + 1;
    S.raycaster.setFromCamera({ x: nx, y: ny }, cam);
    const hits = S.raycaster.intersectObjects(S.scene.children, true).slice(0, 3);
    return hits.map((h) => ({ dist: +h.distance.toFixed(2), chain: describe(h.object) }));
  };

  return { W, H, camPos: cam.position.toArray().map((v) => +v.toFixed(2)) , probe };
});

console.log('canvas', info.W, info.H, 'camera', JSON.stringify(info.camPos));

// 用页面内探针扫两个圈选区域
const scan = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const cam = S.camera;
  const el = S.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const name = (o) => {
    const ud = o.userData || {};
    if (ud.name) return `${o.type}:${ud.kind}/${ud.name}`;
    if (o.geometry?.type) return `${o.type}:${o.geometry.type}`;
    return o.type;
  };
  const hitAt = (px, py) => {
    const nx = (px / W) * 2 - 1;
    const ny = -(py / H) * 2 + 1;
    S.raycaster.setFromCamera({ x: nx, y: ny }, cam);
    const h = S.raycaster.intersectObjects(S.scene.children, true)[0];
    return h ? name(h.object) : 'MISS';
  };
  const areas = {
    left: [95, 190, 275, 325],
    right: [735, 890, 240, 290],
  };
  const out = {};
  for (const [k, [x0, x1, y0, y1]] of Object.entries(areas)) {
    const tally = {};
    for (let x = x0; x <= x1; x += 4) {
      for (let y = y0; y <= y1; y += 4) {
        const h = hitAt(x, y);
        tally[h] = (tally[h] || 0) + 1;
      }
    }
    out[k] = tally;
  }
  return out;
});
console.log('左圈命中分布:', JSON.stringify(scan.left));
console.log('右圈命中分布:', JSON.stringify(scan.right));

// 扫描所有「投影后呈细横线」的对象
const thin = await page.evaluate(() => {
  const S = window.__sandboxScene;
  const cam = S.camera;
  const el = S.renderer.domElement;
  const W = el.clientWidth;
  const H = el.clientHeight;
  const res = [];
  const v = S.camera.position.clone();
  S.scene.updateMatrixWorld(true);
  const proj = (p) => {
    v.copy(p).project(cam);
    return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];
  };
  S.scene.traverse((o) => {
    if (!o.visible) return;
    if (o.type !== 'Mesh' && o.type !== 'Line' && o.type !== 'LineLoop' && o.type !== 'LineSegments') return;
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (!bb) return;
    const box = bb.clone().applyMatrix4(o.matrixWorld);
    const xs = [];
    const ys = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const [sx, sy] = proj({ x, y, z });
          xs.push(sx);
          ys.push(sy);
        }
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    // 细横线：宽 > 25px 且高 < 9px，且不在画面最底部（排除地面网格）
    if (bw > 25 && bh < 9 && cy < H * 0.85) {
      const ud = o.userData || {};
      res.push({
        type: o.type,
        geom: o.geometry.type,
        kind: ud.kind,
        name: ud.name,
        id: ud.id,
        screen: [+cx.toFixed(0), +cy.toFixed(0), +bw.toFixed(0), +bh.toFixed(0)],
        world: [box.min.toArray().map((n) => +n.toFixed(1)), box.max.toArray().map((n) => +n.toFixed(1))],
        mat: o.material?.color ? '#' + o.material.color.getHexString() : undefined,
      });
    }
  });
  return res;
});
console.log('细横线候选对象:');
for (const t of thin) console.log(' ', JSON.stringify(t));

await browser.close();
