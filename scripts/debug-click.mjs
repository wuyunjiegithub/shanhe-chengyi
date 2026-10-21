import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2000);
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2200);
const dhit = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const rect = scene.container.getBoundingClientRect();
  for (let i = 0; i < 140; i++) for (let j = 0; j < 90; j++) {
    const nx = (i/139)*2-1, ny = 1-(j/89)*2;
    const h = scene.pick(nx, ny);
    if (h && h.object.userData.kind === 'district') return { id: h.object.userData.id, x: Math.round(rect.left+((nx+1)/2)*rect.width), y: Math.round(rect.top+((1-ny)/2)*rect.height) };
  }
  return null;
});
console.log('dhit', JSON.stringify(dhit));
await page.mouse.click(dhit.x, dhit.y);
await page.waitForTimeout(1200);
const state = await page.evaluate(() => ({
  drawerOpen: !!document.querySelector('.drawer.is-open'),
  leafBackdrop: document.querySelectorAll('.leaf-backdrop').length,
  leafCard: document.querySelector('.leaf-card')?.textContent?.replace(/\s+/g,' ').trim().slice(0,40) ?? null,
  favHeadBtn: !!document.querySelector('.drawer-head-actions .icon-btn'),
  selected: window.__sandboxScene.selectedDistrictId,
}));
console.log('after click:', JSON.stringify(state));
await browser.close();
