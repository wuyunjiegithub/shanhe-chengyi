/**
 * 抓取全国行政区划边界（DataV.GeoAtlas）
 *
 * - cities.geojson：全国 34 个省级行政区的「地级市 / 直辖市 / 港澳台」轮廓，
 *   作为地图底图与左索引的城市清单（约 340 个城市，~2MB，离线包可容纳）。
 * - districts/*.geojson：仅抓取「已录入内容的省份」（CONTENT_PROVINCES），
 *   避免把全国约 2900 个区县的边界全打进离线包（会让 APK/EXE 膨胀上百 MB）。
 *
 * 新增省份内容时，把对应省 adcode 加入 CONTENT_PROVINCES 再跑一次即可。
 *
 * 运行：node scripts/fetch-geo.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'district-sandbox/0.1' };
const j = async (url) => {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
};
const write = (path, features) => {
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');
  console.log(`已保存 ${features.length} 个要素 → ${path}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync('public/geo/districts', { recursive: true });

// 全国 34 个省级行政区
const PROVINCES = [
  { adcode: '110000', name: '北京市', short: '京' },
  { adcode: '120000', name: '天津市', short: '津' },
  { adcode: '130000', name: '河北省', short: '冀' },
  { adcode: '140000', name: '山西省', short: '晋' },
  { adcode: '150000', name: '内蒙古自治区', short: '蒙' },
  { adcode: '210000', name: '辽宁省', short: '辽' },
  { adcode: '220000', name: '吉林省', short: '吉' },
  { adcode: '230000', name: '黑龙江省', short: '黑' },
  { adcode: '310000', name: '上海市', short: '沪' },
  { adcode: '320000', name: '江苏省', short: '苏' },
  { adcode: '330000', name: '浙江省', short: '浙' },
  { adcode: '340000', name: '安徽省', short: '皖' },
  { adcode: '350000', name: '福建省', short: '闽' },
  { adcode: '360000', name: '江西省', short: '赣' },
  { adcode: '370000', name: '山东省', short: '鲁' },
  { adcode: '410000', name: '河南省', short: '豫' },
  { adcode: '420000', name: '湖北省', short: '鄂' },
  { adcode: '430000', name: '湖南省', short: '湘' },
  { adcode: '440000', name: '广东省', short: '粤' },
  { adcode: '450000', name: '广西壮族自治区', short: '桂' },
  { adcode: '460000', name: '海南省', short: '琼' },
  { adcode: '500000', name: '重庆市', short: '渝' },
  { adcode: '510000', name: '四川省', short: '川' },
  { adcode: '520000', name: '贵州省', short: '黔' },
  { adcode: '530000', name: '云南省', short: '滇' },
  { adcode: '540000', name: '西藏自治区', short: '藏' },
  { adcode: '610000', name: '陕西省', short: '陕' },
  { adcode: '620000', name: '甘肃省', short: '甘' },
  { adcode: '630000', name: '青海省', short: '青' },
  { adcode: '640000', name: '宁夏回族自治区', short: '宁' },
  { adcode: '650000', name: '新疆维吾尔自治区', short: '新' },
  { adcode: '710000', name: '台湾省', short: '台' },
  { adcode: '810000', name: '香港特别行政区', short: '港' },
  { adcode: '820000', name: '澳门特别行政区', short: '澳' },
];

// 仅给「已录入内容」的省份抓取区县边界
const CONTENT_PROVINCES = new Set(['310000', '320000', '330000', '340000', '110000']);

// 直辖市 / 特别行政区：市本级即地级市，区县直接从本省 _full 取
const MUNICIPALITIES = new Set(['110000', '120000', '310000', '500000', '810000', '820000']);

const cityFeatures = [];
const failed = [];

for (const p of PROVINCES) {
  try {
    const data = await j(`https://geo.datav.aliyun.com/areas_v3/bound/${p.adcode}_full.json`);
    const feats = data.features ?? [];
    await sleep(60);

    if (MUNICIPALITIES.has(p.adcode)) {
      const outline = feats.find((f) => f.properties?.level === 'province') ?? feats[0];
      cityFeatures.push({
        type: 'Feature',
        properties: {
          id: p.adcode,
          name: p.name,
          province: p.name,
          short: p.short,
          indexed: false,
          center: outline?.properties?.centroid ?? outline?.properties?.center ?? null,
        },
        geometry: outline.geometry,
      });
      if (CONTENT_PROVINCES.has(p.adcode)) {
        const df = feats
          .filter((f) => f.properties?.level === 'district')
          .map((f) => ({
            type: 'Feature',
            properties: {
              id: String(f.properties.adcode),
              name: f.properties.name,
              province: p.name,
              short: p.short,
              center: f.properties.centroid ?? f.properties.center ?? null,
            },
            geometry: f.geometry,
          }));
        write(`public/geo/districts/${p.adcode}.geojson`, df);
      }
      continue;
    }

    const cities = feats.filter((f) => f.properties?.level === 'city');
    for (const c of cities) {
      const adcode = String(c.properties.adcode);
      cityFeatures.push({
        type: 'Feature',
        properties: {
          id: adcode,
          name: c.properties.name,
          province: p.name,
          short: p.short,
          indexed: false,
          center: c.properties.centroid ?? c.properties.center ?? null,
        },
        geometry: c.geometry,
      });
    }
    if (CONTENT_PROVINCES.has(p.adcode)) {
      for (const c of cities) {
        const adcode = String(c.properties.adcode);
        try {
          const d = await j(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
          const df = (d.features ?? [])
            .filter((f) => f.properties?.level === 'district')
            .map((f) => ({
              type: 'Feature',
              properties: {
                id: String(f.properties.adcode),
                name: f.properties.name,
                province: p.name,
                short: p.short,
                center: f.properties.centroid ?? f.properties.center ?? null,
              },
              geometry: f.geometry,
            }));
          write(`public/geo/districts/${adcode}.geojson`, df);
          await sleep(60);
        } catch (e) {
          failed.push(`${c.properties.name}（区县）：${e.message}`);
        }
      }
    }
  } catch (e) {
    failed.push(`${p.name}：${e.message}`);
  }
}

write('public/geo/cities.geojson', cityFeatures);
console.log(`完成：城市轮廓 ${cityFeatures.length} 个`);
if (failed.length) console.log('失败列表：\n  ' + failed.join('\n  '));
