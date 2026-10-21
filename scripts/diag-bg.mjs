// 诊断：自定义背景图上传链路
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';
import { makePng } from './fixture-png.mjs';

const URL = 'http://127.0.0.1:1421/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('regression-shots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => console.log('CONSOLE:' + m.type(), m.text()));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__sandboxApp.focusCityById('310000'));
await page.waitForTimeout(1600);

const before = await page.evaluate(() => {
  const cover = document.querySelector('.city-cover');
  return {
    cover: !!cover,
    html: cover ? cover.innerHTML.slice(0, 300) : null,
    inputs: document.querySelectorAll('.city-cover input[type=file]').length,
  };
});
console.log('上传前:', JSON.stringify(before, null, 1));

const pngPath = path.join(OUT, 'bg-fixture.png');
fs.writeFileSync(pngPath, makePng(240, 160, [20, 180, 120]));
await page.setInputFiles('.city-cover input[type=file]', pngPath);
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  const cover = document.querySelector('.city-cover');
  let map = null;
  try {
    map = JSON.parse(localStorage.getItem('ds.backgrounds.v1') || '{}');
  } catch {}
  return {
    html: cover ? cover.innerHTML.slice(0, 400) : null,
    map,
    toast: document.querySelector('.hud-toast')?.textContent ?? null,
  };
});
console.log('上传后:', JSON.stringify(after, null, 1));

await browser.close();
