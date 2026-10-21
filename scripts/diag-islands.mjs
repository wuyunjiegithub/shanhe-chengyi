import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const BASE = 'http://127.0.0.1:1421/';
const OUT = 'D:/code/hermes_code/district-sandbox/regression-shots';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

// enter Zhoushan, then zoom close & lower camera angle to a grazing view of the islands
await page.evaluate(() => window.__sandboxApp?.focusCityById('330900'));
await page.waitForTimeout(2200);
const info = await page.evaluate(() => {
  const s = window.__sandboxScene;
  const recs = [...s.districts.values()];
  return {
    districtCount: recs.length,
    heights: recs.map((r) => ({ h: Math.round(r.height * 100) / 100, meshes: r.meshes.length, ped: r.pedestals.length })),
  };
});
console.log('districts:', JSON.stringify(info));

// lower angle + zoom on the archipelago (east side)
await page.evaluate(() => {
  const s = window.__sandboxScene;
  const cam = s.camera;
  const ctrl = s.controls;
  // center of Zhoushan islands approx: find 嵊泗/岱山 centroid max x
  let cx = 0, cz = 0, n = 0;
  for (const r of s.districts.values()) { cx += r.centroid[0]; cz += -r.centroid[1]; n++; }
  cx /= Math.max(1, n); cz /= Math.max(1, n);
  const tx = cx, ty = 2, tz = cz;
  ctrl.target.set(tx, ty, tz);
  // grazing angle: elevation ~ 18deg, distance 60
  const dist = 62, elev = 16 * Math.PI / 180;
  cam.position.set(tx, ty + Math.sin(elev) * dist, tz + Math.cos(elev) * dist);
  cam.lookAt(tx, ty, tz);
  ctrl.update();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/c6-islands-low.png` });
console.log('islands-low shot done');
await browser.close();
