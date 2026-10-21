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

mkdirSync('public/geo/districts', { recursive: true });

const provinces = [
  { adcode: '320000', name: '江苏省' },
  { adcode: '330000', name: '浙江省' },
  { adcode: '340000', name: '安徽省' },
];

const cities = []; // { adcode, name, province }
const cityFeatures = [];

for (const p of provinces) {
  const data = await j(`https://geo.datav.aliyun.com/areas_v3/bound/${p.adcode}_full.json`);
  for (const f of data.features ?? []) {
    if (f.properties?.level !== 'city') continue;
    const adcode = String(f.properties.adcode);
    cities.push({ adcode, name: f.properties.name, province: p.name });
    cityFeatures.push({
      type: 'Feature',
      properties: {
        id: adcode,
        name: f.properties.name,
        province: p.name,
        indexed: f.properties.name === '杭州市',
        center: f.properties.centroid ?? f.properties.center ?? null,
      },
      geometry: f.geometry,
    });
  }
}

// 上海（直辖市，取 310000 本体轮廓作为单板块）
const shGeo = await j('https://geo.datav.aliyun.com/areas_v3/bound/310000.json');
const shFeature = (shGeo.features ?? [])[0];
cities.push({ adcode: '310000', name: '上海市', province: '上海市' });
cityFeatures.push({
  type: 'Feature',
  properties: {
    id: '310000',
    name: '上海市',
    province: '上海市',
    indexed: false,
    center: shFeature?.properties?.centroid ?? shFeature?.properties?.center ?? null,
  },
  geometry: shFeature.geometry,
});

write('public/geo/cities.geojson', cityFeatures);

// 抓取每个市的区县边界
const failed = [];
for (const c of cities) {
  try {
    const data = await j(`https://geo.datav.aliyun.com/areas_v3/bound/${c.adcode}_full.json`);
    const features = (data.features ?? []).map((f) => ({
      type: 'Feature',
      properties: {
        id: String(f.properties.adcode),
        name: f.properties.name,
        province: c.province,
        center: f.properties.centroid ?? f.properties.center ?? null,
      },
      geometry: f.geometry,
    }));
    if (features.length === 0) {
      failed.push(`${c.name}（0 个区县）`);
      continue;
    }
    write(`public/geo/districts/${c.adcode}.geojson`, features);
  } catch (e) {
    failed.push(`${c.name}：${e.message}`);
  }
}

if (failed.length) console.log('失败列表：\n  ' + failed.join('\n  '));
console.log(`完成：城市 ${cities.length} 个，成功抓取 ${cities.length - failed.length} 个市的区县`);