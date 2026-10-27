/**
 * 生成台湾省的区县边界：public/geo/districts/710000.geojson
 *
 * 背景：DataV 的 `710000_full.json`（区县级）返回 404，所以台湾省一直只有省级轮廓、
 * 0 个区县 —— 用户反馈「台湾什么都没有」。改用 geoBoundaries 的 gbOpen/TWN/ADM1
 * （22 个一级单元，正是台湾省的县市），转成与本项目一致的格式。
 *
 * 两个必须交代的处理：
 *
 * 1. **金门、马祖不并入台湾省**。geoBoundaries 的 22 个单元里有 Kinmen（金门）与
 *    Matsu Islands（马祖）。按我国官方行政区划，金门县属福建省泉州市、连江县（马祖）
 *    属福建省福州市，不属于台湾省。这里按官方口径剔除，得到 20 个单元。
 *
 * 2. **区县代码是内部顺序号**。GB/T 2260 未公开台湾省下辖县市的代码，
 *    这里用 710001…710020 顺序编号。之所以能这么编：本项目 cityIdOfDistrict 的
 *    归并规则是「前 4 位 + 00」，710001 → 710000，正好落到台湾省，无需改归并逻辑。
 *
 * 运行：node scripts/gen-taiwan-geo.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SRC = join(ROOT, 'scripts/.cache/gb_TWN_1.geojson');
const OUT_DIR = join(ROOT, 'public/geo/districts');
const OUT = join(OUT_DIR, '710000.geojson');
const GB_URL =
  'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TWN/ADM1/geoBoundaries-TWN-ADM1.geojson';

/** geoBoundaries 英文名 → 中文名 + 内部顺序号（按台湾省由北向南、本岛后离岛的惯例排） */
const NAME_MAP = {
  Taipei: ['台北市', '710001'],
  'New Taipei': ['新北市', '710002'],
  Taoyuan: ['桃园市', '710003'],
  Taichung: ['台中市', '710004'],
  Tainan: ['台南市', '710005'],
  Kaohsiung: ['高雄市', '710006'],
  Keelung: ['基隆市', '710007'],
  Hsinchu: ['新竹市', '710008'],
  'Hsinchu County': ['新竹县', '710009'],
  'Miaoli County': ['苗栗县', '710010'],
  'Changhua County': ['彰化县', '710011'],
  'Nantou County': ['南投县', '710012'],
  'Yunlin County': ['云林县', '710013'],
  'Chiayi County': ['嘉义县', '710014'],
  Chiayi: ['嘉义市', '710015'],
  'Pingtung County': ['屏东县', '710016'],
  'Yilan County': ['宜兰县', '710017'],
  'Hualien County': ['花莲县', '710018'],
  'Taitung County': ['台东县', '710019'],
  Penghu: ['澎湖县', '710020'],
  // 金门（Kinmen）与马祖（Matsu Islands）按官方行政区划属福建省，不并入台湾省
};

/**
 * 面积太小的碎岛（环）直接丢弃：它们在地图上不足 1px，却吃掉大半体积。
 * 5e-5 平方度 ≈ 0.6 km²，澎湖那种几十个小岛里只留下真正看得见的几个。
 */
const MIN_RING_AREA = 5e-5;
/**
 * 抽稀阈值（度）。5e-4 度 ≈ 55 m —— 全国视图下台湾全省只占几十像素，
 * 城市视图下 55m 的误差完全看不出来；阈值再小下去体积就失控了
 * （1e-4 时 815KB，是现有最大区县文件的 5 倍）。
 */
const SIMPLIFY_TOL = 5e-4;
const PRECISION = 5;

if (!existsSync(SRC)) {
  mkdirSync(join(ROOT, 'scripts/.cache'), { recursive: true });
  console.log('· 下载 geoBoundaries TWN ADM1 …');
  execFileSync('curl', ['-sL', '--max-time', '180', '-o', SRC, GB_URL], { stdio: 'inherit' });
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

/** 环的带符号面积（鞋带公式），取绝对值判断大小 */
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

/**
 * Douglas-Peucker 抽稀。
 *
 * 关键坑：**闭合环不能整段直接抽稀**。行政区外环首尾点重合，初始弦长度为 0，
 * 于是每个点到这条「弦」的垂距都算成 0，整环会被抽成只剩 2 个点（实测：台北 1293 → 2）。
 * 正确做法：先在环上找离起点最远的点作分割点，再对两段分别抽稀，最后重新闭合。
 */
function markDP(keep, pts, s, e, tol) {
  keep[s] = 1;
  keep[e] = 1;
  const stack = [[s, e]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const den = Math.hypot(dx, dy);
    if (den === 0) continue;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / den;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
}

function simplify(ring, tol) {
  const n = ring.length;
  if (n <= 5) return ring;
  const closed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const pts = closed ? ring.slice(0, n - 1) : ring.slice();
  const m = pts.length;
  if (m <= 4) return ring;

  // 找离起点最远的点作为分割点（闭合环的对径点）
  let far = 0;
  let farD = -1;
  for (let i = 1; i < m; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Uint8Array(m);
  markDP(keep, pts, 0, far, tol);
  markDP(keep, pts, far, m - 1, tol);

  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** 多边形质心（面积加权，比节点均值更接近视觉中心） */
function centroidOf(polygon) {
  let cx = 0;
  let cy = 0;
  let total = 0;
  for (const ring of polygon) {
    let a = 0;
    let rx = 0;
    let ry = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      rx += (ring[j][0] + ring[i][0]) * cross;
      ry += (ring[j][1] + ring[i][1]) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) continue;
    const w = Math.abs(a);
    cx += (rx / (6 * a)) * w;
    cy += (ry / (6 * a)) * w;
    total += w;
  }
  if (total === 0) {
    const p = polygon[0][0];
    return [p[0], p[1]];
  }
  return [cx / total, cy / total];
}

const round = (n) => Number(n.toFixed(PRECISION));

const features = [];
const skipped = [];
for (const f of raw.features ?? []) {
  const en = f.properties?.shapeName;
  const map = NAME_MAP[en];
  if (!map) {
    skipped.push(en);
    continue;
  }
  const [name, id] = map;
  const geoms = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.coordinates ?? [];
  const polygons = [];
  for (const poly of geoms) {
    // poly[0] 是外环，其余是内环（洞）；台湾各县市基本无洞，一并保留
    const rings = poly
      .filter((r) => ringArea(r) >= MIN_RING_AREA)
      .map((r) => {
        const s = simplify(r, SIMPLIFY_TOL);
        // 首末点必须闭合
        if (s.length && (s[0][0] !== s[s.length - 1][0] || s[0][1] !== s[s.length - 1][1])) {
          s.push([s[0][0], s[0][1]]);
        }
        return s.map(([x, y]) => [round(x), round(y)]);
      })
      .filter((r) => r.length >= 4);
    if (rings.length) polygons.push(rings);
  }
  if (!polygons.length) {
    skipped.push(`${en}(几何被抽空)`);
    continue;
  }
  polygons.sort((a, b) => ringArea(b[0]) - ringArea(a[0]));
  const [lng, lat] = centroidOf(polygons[0]);
  features.push({
    type: 'Feature',
    properties: {
      id,
      name,
      province: '台湾省',
      short: '台',
      center: [round(lng), round(lat)],
    },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  });
}

// 按代码排序，保证产物稳定（重跑不产生无意义 diff）
features.sort((a, b) => a.properties.id.localeCompare(b.properties.id));

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));

const bytes = Buffer.byteLength(readFileSync(OUT, 'utf8'));
console.log(`· 写出 ${OUT}`);
console.log(`   ${features.length} 个县市，${(bytes / 1024).toFixed(1)} KB`);
console.log(`   ${features.map((f) => f.properties.name).join('、')}`);
if (skipped.length) console.log(`   已剔除（属福建省，非台湾省）：${skipped.join('、')}`);
