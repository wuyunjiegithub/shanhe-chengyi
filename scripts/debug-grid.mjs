import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const rect = s.container.getBoundingClientRect();
  // 找 GridHelper
  let grid = null;
  s.scene.traverse((o) => { if (!grid && o.type === 'GridHelper') grid = o; });
  const THREE = s.scene.constructor; // 不可靠，改用 matrixWorld 计算
  function projY(v) {
    const p = v.clone().project(cam);
    return Math.round(rect.top + ((1 - p.y) / 2) * rect.height);
  }
  const res = { viewportH: rect.height };
  if (grid) {
    grid.updateWorldMatrix(true, false);
    // grid 的局部范围是 ±(size/2)；scale.x 已应用
    const halfLocal = 200; // GridHelper(400) => ±200
    const sx = grid.scale.x, sz = grid.scale.z;
    const cx = grid.position.x, cz = grid.position.z;
    const bottomZ = cz + halfLocal * sz; // 屏幕下方（z 大 = 靠近相机）
    const topZ = cz - halfLocal * sz;
    // 世界坐标点（y 取 grid.position.y）
    const mk = (x, z) => new (grid.position.constructor)(x, grid.position.y, z);
    res.grid = {
      scale: [Math.round(sx*1000)/1000, Math.round(sz*1000)/1000],
      pos: [Math.round(cx*10)/10, Math.round(cz*10)/10],
      bottomEdgeScreenY: projY(mk(cx, bottomZ)),
      topEdgeScreenY: projY(mk(cx, topZ)),
      leftEdgeScreenX: Math.round(rect.left + (( (new (grid.position.constructor)(cx - halfLocal*sx, grid.position.y, cz)).project(cam).x + 1)/2)*rect.width),
    };
  }
  // 地图（cityGroup）世界包围盒 & 底边投影
  const box = s.scene.children.find(o=>o.name==='cityGroup') || null;
  // 用 regionBox 不可访问，改遍历城市网格计算
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  s.cities.forEach((rec)=>{ rec.meshes.forEach((m)=>{ m.updateWorldMatrix(true,false); const b=m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox); const bb=b.clone().applyMatrix4(m.matrixWorld); minX=Math.min(minX,bb.min.x); maxX=Math.max(maxX,bb.max.x); minZ=Math.min(minZ,bb.min.z); maxZ=Math.max(maxZ,bb.max.z); }); });
  const V = grid ? grid.position.constructor : null;
  if (V) {
    res.map = {
      x: [Math.round(minX*10)/10, Math.round(maxX*10)/10],
      z: [Math.round(minZ*10)/10, Math.round(maxZ*10)/10],
      bottomEdgeScreenY: projY(new V((minX+maxX)/2, 0, maxZ)),
    };
  }
  return res;
});
console.log(JSON.stringify(info, null, 2));

import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'g-national.png') });
const box2 = await page.evaluate(() => { const c = window.__sandboxScene.container; return { w: c.clientWidth, h: c.clientHeight }; });
await page.screenshot({ path: path.join(OUT, 'g-bottom.png'), clip: { x: 0, y: Math.max(0, box2.h - 170), width: box2.w, height: 170 } });

// 进入上海市，看城市视图是否还有多余线
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2400);
await page.screenshot({ path: path.join(OUT, 'g-shanghai.png') });
const box3 = await page.evaluate(() => { const c = window.__sandboxScene.container; return { w: c.clientWidth, h: c.clientHeight }; });
await page.screenshot({ path: path.join(OUT, 'g-shanghai-bottom.png'), clip: { x: 0, y: Math.max(0, box3.h - 170), width: box3.w, height: 170 } });

await browser.close();
