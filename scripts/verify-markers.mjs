// 验证足迹数据：预置去过/想去/收藏，检查面板列表与 3D 标记
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

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

// 预置足迹数据
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem('ds.cityStatus.v1', JSON.stringify({
    want: ['330100', '320500'],
    visited: ['310000', '330200'],
    visitedDistricts: ['310101', '330203'],
  }));
  localStorage.setItem('ds.favorites.v1', JSON.stringify({
    districts: ['310118', '330110'],
    spots: ['qp-zhujiajiao', 'hz-xihu'],
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(2000);

// 区域视角：城市标记（红旗=去过，书签=想去）
const markers = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  const cityM = scene.cityMarkerGroup.children.map((m) => ({
    id: m.userData.plateId,
    type: m.children[0]?.type === 'Mesh' && m.children[1]?.type === 'Mesh' ? 'flag-group' : 'other',
    y: Math.round(m.position.y * 100) / 100,
  }));
  return { cityMarkers: cityM, cityGroupVisible: scene.cityMarkerGroup.visible, districtGroupVisible: scene.districtMarkerGroup.visible };
});
console.log('region markers:', JSON.stringify(markers));
await page.screenshot({ path: path.join(OUT, 'v4-region-markers.png') });

// 打开足迹面板
await page.locator('.fav-pill').click();
await page.waitForTimeout(600);
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.fav-panel .fav-section')].map((sec) => ({
    title: sec.querySelector('.block-title')?.textContent,
    items: [...sec.querySelectorAll('.fav-item')].map((el) => ({
      name: el.querySelector('.fav-item-name')?.textContent,
      sub: el.querySelector('.fav-item-sub')?.textContent,
      mark: el.querySelector('.fav-item-mark')?.firstElementChild?.getAttribute('class'),
    })),
  })),
);
console.log('panel rows:', JSON.stringify(rows, null, 1));
await page.screenshot({ path: path.join(OUT, 'v5-fav-filled.png') });
await page.keyboard.press('Escape');

// 进入上海：区县标记
await page.locator('.index-row', { hasText: '上海市' }).first().click();
await page.waitForTimeout(2000);
const dmarkers = await page.evaluate(() => {
  const scene = window.__sandboxScene;
  return {
    districtMarkers: scene.districtMarkerGroup.children.map((m) => m.userData.plateId),
    cityVisible: scene.cityMarkerGroup.visible,
    districtVisible: scene.districtMarkerGroup.visible,
  };
});
console.log('city view markers:', JSON.stringify(dmarkers));
await page.screenshot({ path: path.join(OUT, 'v6-city-markers.png') });

await browser.close();
console.log('done');
