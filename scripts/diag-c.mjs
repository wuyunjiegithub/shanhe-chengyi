import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core');

const BASE = 'http://127.0.0.1:1421/';
const OUT = 'D:/code/hermes_code/district-sandbox/regression-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 1) national view (grid + middle line)
await page.screenshot({ path: `${OUT}/c1-national.png` });
console.log('1) national shot done');

// 2) Zhoushan city view (islands / pillars)
await page.evaluate(() => window.__sandboxApp?.focusCityById('330900'));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/c2-zhoushan.png` });
console.log('2) zhoushan shot done');

// 3) back to region via Esc -> check black
await page.keyboard.press('Escape');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/c3-after-esc.png` });
console.log('3) after-esc shot done');

// 4) photo wall 3D then close (white screen?)
await page.evaluate(() => window.__sandboxApp?.focusCityById('330900'));
await page.waitForTimeout(2000);
const trigger = await page.$('.photo-wall-trigger');
if (trigger) {
  await trigger.click();
  await page.waitForTimeout(1200);
  const hall3d = await page.$('.wall-style-chip:has-text("展厅 · 3D")');
  if (hall3d) {
    await hall3d.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/c4-hall3d.png` });
    console.log('4) hall3d shot done');
  } else {
    console.log('4) hall3d chip not found');
  }
  // close
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/c5-after-close.png` });
  console.log('5) after-close shot done');
} else {
  console.log('4) photo-wall-trigger not found');
}

console.log('ERRORS:', JSON.stringify(errors.slice(0, 10), null, 2));
await browser.close();
