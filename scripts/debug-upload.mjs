import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
const IMG = path.join(OUT, 'sample-note.png');
fs.writeFileSync(IMG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvg0hAAABh8H8TwAAAABJRU5ErkJggg==','base64'));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type()==='error') errs.push('CONSOLE '+m.text()); });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2000);
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2200);
await page.evaluate(() => window.__sandboxApp.selectDistrictById('310118'));
await page.waitForTimeout(1200);
await page.locator('.drawer-actions .ghost-btn', { hasText: '写游记' }).click();
await page.waitForTimeout(800);
const fileInput = page.locator('.note-images input[type=file]');
console.log('fileInput count:', await fileInput.count());
console.log('fileInput visible:', await fileInput.isVisible().catch(()=>'n/a'));
await fileInput.setInputFiles(IMG);
await page.waitForTimeout(4000);
const st = await page.evaluate(() => ({
  li: document.querySelectorAll('.note-image-grid li').length,
  img: document.querySelectorAll('.note-image-grid li img').length,
  loading: document.querySelectorAll('.note-image-loading').length,
  toast: document.querySelector('.toast')?.textContent?.trim() ?? null,
}));
console.log('after upload:', JSON.stringify(st));
console.log('ERRORS:', errs.length?JSON.stringify(errs):'none');
await browser.close();
