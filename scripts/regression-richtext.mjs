import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';

const { chromium } = pw;
const OUT = 'D:/code/hermes_code/district-sandbox/output';
const errors = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
});

function seed() {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 460;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 720, 460);
  g.addColorStop(0, '#1b4d5a');
  g.addColorStop(1, '#8aa87f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 720, 460);
  ctx.fillStyle = '#fff';
  ctx.font = '600 42px sans-serif';
  ctx.fillText('徽杭古道 · 测试图', 48, 260);
  return new Promise((resolve, reject) => {
    c.toBlob(async (blob) => {
      const put = (id) =>
        new Promise((res, rej) => {
          const req = indexedDB.open('ds-travel-images', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('images', 'readwrite');
            tx.objectStore('images').put({ id, blob, name: `${id}.png`, type: 'image/png', createdAt: Date.now() });
            tx.oncomplete = () => {
              db.close();
              res();
            };
            tx.onerror = () => rej(tx.error);
          };
          req.onerror = () => rej(req.error);
        });
      await put('img-test1');
      await put('img-test2');
      localStorage.setItem(
        'ds.travelNotes.v1',
        JSON.stringify([
          {
            id: 'note-legacy',
            title: '徽杭古道两日',
            body: '第一天：从浙基田起步，一路向上，竹林里全是水汽。\n\n{{图:img-test1}}\n\n第二天：下山，腿有点抖。',
            placeKind: 'city',
            placeId: 'hangzhou',
            placeName: '杭州',
            images: ['img-test1'],
            createdAt: Date.now() - 86400000,
            updatedAt: Date.now() - 86400000,
          },
        ]),
      );
      resolve();
    }, 'image/png');
  });
}

const report = {};

await page.goto('http://localhost:1421/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.evaluate(seed);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hud-top', { timeout: 15000 });
await page.waitForTimeout(1800);

// 打开游记面板
await page.getByRole('button', { name: /游记/ }).first().click();
await page.waitForSelector('.note-card', { timeout: 8000 });
report.listOk = await page.locator('.note-card').count();
report.excerpt = (await page.locator('.note-card-excerpt').first().innerText()).trim();

// 打开这篇（旧格式）游记
await page.locator('.note-card').first().click();
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(600);

report.hasToolbar = await page.locator('.rt-toolbar .rt-btn').count();
report.toolbarLabels = await page.locator('.rt-toolbar .rt-btn').allInnerTexts();
report.paragraphs = await page.locator('.rt-body p').count();
report.storedHtml = await page.evaluate(() => document.querySelector('.rt-body')?.innerHTML ?? '');
report.imgSrc = await page.evaluate(() => {
  const img = document.querySelector('.rt-body img[data-img]');
  return img ? { dataImg: img.getAttribute('data-img'), src: (img.getAttribute('src') || '').slice(0, 12) } : null;
});
report.bodyHeight = await page.evaluate(() => Math.round(document.querySelector('.rt-body')?.getBoundingClientRect().height ?? 0));
report.noPreviewPanel = (await page.locator('.note-preview').count()) === 0;
await page.screenshot({ path: `${OUT}/rt-open.png` });

// 末尾续写 + 用工具栏加标题
await page.locator('.rt-body').click();
await page.evaluate(() => {
  const el = document.querySelector('.rt-body');
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.keyboard.press('Enter');
await page.keyboard.type('第三天：在村口喝了碗笋干汤');
await page.locator('.rt-toolbar .rt-btn', { hasText: '小标题' }).click();
await page.waitForTimeout(300);
report.hasH3 = await page.locator('.rt-body h3').count();

// 加粗：选中最后一段再点 B（标题里 Blink 不允许 bold，所以选普通段落）
await page.evaluate(() => {
  const ps = document.querySelectorAll('.rt-body p');
  const p = ps[ps.length - 1];
  if (!p) return;
  const r = document.createRange();
  r.selectNodeContents(p);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
});
await page.locator('.rt-toolbar .rt-btn').first().click();
await page.waitForTimeout(300);
report.hasBold = await page.evaluate(() => Boolean(document.querySelector('.rt-body b, .rt-body strong')));
report.boldHtml = await page.evaluate(() => document.querySelector('.rt-body')?.innerHTML.slice(-90) ?? '');

// 插一张图（走编辑器真实插入路径：插到光标处 + 落库 + 回填 src）
await page.evaluate(() => window.__noteEditor?.insertImages([{ id: 'img-test2' }]));
await page.waitForTimeout(1500);
report.imgCount = await page.locator('.rt-body img[data-img]').count();
report.imgStates = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.rt-body img[data-img]')).map((i) => ({
    id: i.getAttribute('data-img'),
    src: (i.getAttribute('src') || '(none)').slice(0, 16),
  })),
);
report.allImgsHaveSrc = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.rt-body img[data-img]')).every((i) => (i.getAttribute('src') || '').startsWith('blob:')),
);
report.imgCounter = (await page.locator('.rt-count').innerText()).replace(/\s+/g, ' ');

// 点图片 -> 浮出删除钮 -> 删掉，计数要跟着减
await page.locator('.rt-body img[data-img]').last().click();
await page.waitForTimeout(250);
report.delChip = await page.locator('.rt-img-del').count();
await page.screenshot({ path: `${OUT}/rt-imgdel.png` });
await page.locator('.rt-img-del').click();
await page.waitForTimeout(400);
report.afterDelete = {
  img: await page.locator('.rt-body img[data-img]').count(),
  counter: (await page.locator('.rt-count').innerText()).replace(/\s+/g, ' '),
};
// 再插回来，验证可反复增删
await page.evaluate(() => window.__noteEditor?.insertImages([{ id: 'img-test2' }]));
await page.waitForTimeout(700);
report.reinsert = await page.locator('.rt-body img[data-img]').count();
await page.screenshot({ path: `${OUT}/rt-edited.png` });

// 保存，检查落库格式
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForSelector('.note-card', { timeout: 8000 });
await page.waitForTimeout(500);
report.saved = await page.evaluate(() => {
  const list = JSON.parse(localStorage.getItem('ds.travelNotes.v1') || '[]');
  const n = list[0];
  return n
    ? {
        body: n.body,
        images: n.images,
        isHtml: n.body.trim().startsWith('<'),
        hasBlobSrc: /blob:|src=/.test(n.body),
        emptyShells: /<b><\/b>|<p><\/p>|<i><\/i>/.test(n.body),
      }
    : null;
});
report.excerptAfter = (await page.locator('.note-card-excerpt').first().innerText()).trim();
await page.screenshot({ path: `${OUT}/rt-list.png` });

// 重新打开：HTML 持久化后还能正常回显
await page.locator('.note-card').first().click();
await page.waitForSelector('.rt-body', { timeout: 8000 });
await page.waitForTimeout(700);
report.reopen = {
  h3: await page.locator('.rt-body h3').count(),
  img: await page.locator('.rt-body img[data-img]').count(),
  srcOk: await page.evaluate(() =>
    Array.from(document.querySelectorAll('.rt-body img[data-img]')).every((i) => (i.getAttribute('src') || '').startsWith('blob:')),
  ),
};
await page.screenshot({ path: `${OUT}/rt-reopen.png` });

report.pageErrors = errors;
report.consoleErrors = consoleErrors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
