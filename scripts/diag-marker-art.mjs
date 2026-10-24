/** 量标记贴图：实心图形的包围盒 + 下沿空隙（= 屏幕上「悬空」的比例） */
import pw from 'file:///C:/Users/user/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const URL = process.env.REG_URL || 'http://localhost:1420/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME });
const pc = await browser.newPage({ viewport: { width: 900, height: 700 } });
await pc.goto(URL, { waitUntil: 'networkidle' });
await pc.waitForTimeout(3000);

const out = await pc.evaluate(async () => {
  const mod = await import('/src/scene/markerArt.ts');
  const res = [];
  const probe = (kind, style) => {
    const cv = mod.renderMarkerCanvas(kind, style);
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let top = -1;
    let bottom = -1;
    let left = -1;
    let right = -1;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y * cv.width + x) * 4 + 3] > 200) {
          if (top < 0) top = y;
          bottom = y;
          if (left < 0 || x < left) left = x;
          if (right < 0 || x > right) right = x;
        }
      }
    }
    res.push({
      name: kind === 'favorite' ? '爱心' : style,
      h: cv.height,
      w: cv.width,
      top,
      bottom,
      left,
      right,
      shapeH: bottom - top + 1,
      shapeW: right - left + 1,
      gapPct: +(((cv.height - 1 - bottom) / cv.height) * 100).toFixed(1),
      screenPx: kind === 'favorite' ? mod.FAVORITE_SCREEN_PX : mod.VISITED_SCREEN_PX[style],
    });
  };
  for (const s of ['flag', 'pin', 'stamp', 'footprint']) probe('visited', s);
  probe('favorite', 'flag');
  return res;
});

for (const r of out) {
  const onScreen = ((r.shapeH / r.h) * r.screenPx).toFixed(1);
  console.log(
    `${r.name.padEnd(10)} 图形 ${r.shapeW}x${r.shapeH} (x ${r.left}~${r.right}, y ${r.top}~${r.bottom})` +
      `  下沿空隙 ${r.gapPct}%  贴片屏高 ${r.screenPx}px → 实际约 ${onScreen}px` +
      (r.left <= 0 || r.right >= r.w - 1 ? '  ⚠左右溢出' : ''),
  );
}
await browser.close();
