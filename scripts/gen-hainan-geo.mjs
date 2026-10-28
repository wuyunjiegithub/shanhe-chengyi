/**
 * 生成海南省全部 19 个市/县的区县边界：public/geo/districts/<adcode>.geojson
 *
 * 背景：之前全量抓取只留下了海口(460100)/三亚(460200)/三沙(460300) 三个市的边界，
 * 儋州(460400) 与 15 个省直辖县级市/县（469001…469030）既没边界也没内容，
 * 点进去是「待录入」。本脚本把海南 19 个市全部补齐，使它们都能下钻。
 *
 * 数据用 DataV GeoAtlas（与 fetch-geo.mjs 同源），逐市抓 <adcode>_full.json：
 * - 地级市（海口/三亚/三沙/儋州）：取 level==='district' 的区县
 * - 省直辖县级市/县（如五指山 469001）：自身即一个 district 要素
 *
 * 运行：node scripts/gen-hainan-geo.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'public/geo/districts');
mkdirSync(OUT_DIR, { recursive: true });

const CACHE = join(ROOT, 'scripts/.cache/hn-460000.json');
if (!existsSync(CACHE)) {
  throw new Error('缺少 scripts/.cache/hn-460000.json，请先 curl 下载 460000_full.json');
}
const full = JSON.parse(readFileSync(CACHE, 'utf8'));
const province = '海南省';
const short = '琼';

// 父级 460000_full 里每个市/县的要素（省直辖县级市与儋州没有独立的 _full，几何直接在这儿）
const byAdcode = new Map();
for (const f of full.features ?? []) byAdcode.set(String(f.properties.adcode), f);

const j = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'district-sandbox/0.1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
};

/** 把某个要素转成本项目 district 要素（id/name/province/center） */
const toDistrict = (f) => ({
  type: 'Feature',
  properties: {
    id: String(f.properties.adcode),
    name: f.properties.name,
    province,
    short,
    center: f.properties.centroid ?? f.properties.center ?? null,
  },
  geometry: f.geometry,
});

let total = 0;
for (const c of full.features ?? []) {
  const adcode = String(c.properties.adcode);
  const name = c.properties.name;
  let out = [];
  try {
    const d = await j(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
    const feats = d.features ?? [];
    let chosen = feats.filter((f) => f.properties?.level === 'district');
    if (!chosen.length) chosen = feats.filter((f) => f.properties?.level === 'city');
    out = chosen.map(toDistrict);
  } catch {
    // 抓不到 _full（省直辖县级市 / 儋州）：直接用父级 460000_full 里的自身几何作为单一区县
  }
  if (!out.length) {
    const self = byAdcode.get(adcode);
    if (self) out = [toDistrict(self)];
  }
  if (out.length) {
    writeFileSync(join(OUT_DIR, `${adcode}.geojson`), JSON.stringify({ type: 'FeatureCollection', features: out }));
    console.log(`· ${name}(${adcode}): ${out.length} 个区县`);
    total += out.length;
  } else {
    console.log(`· ${name}(${adcode}): 无区县要素，跳过`);
  }
}
console.log(`完成：海南共 ${total} 个区县要素已写入 ${OUT_DIR}`);
