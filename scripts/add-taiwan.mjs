/**
 * 把台湾省补进底图（cities.geojson）。
 *
 * DataV 的 710000_full.json 返回 404，导致 fetch-geo.mjs 把整省吞掉、台湾在地图上完全消失。
 * 但 710000.json（省级轮廓）是可用的，本脚本用它把台湾省作为一个「省份级」要素写入
 * cities.geojson（与直辖市同处理：无下级区县，标记为待录入）。
 *
 * 台湾省无下级区县（childrenNum=0，DataV 也无区县边界源），所以只画省轮廓；
 * 后续若有可靠区县边界源再单独补 districts/710000.geojson。
 *
 * 运行：node scripts/add-taiwan.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CITIES = path.join(ROOT, 'public/geo/cities.geojson');
const TAIWAN_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/710000.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTaiwan() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(TAIWAN_URL, {
        headers: { 'User-Agent': 'district-sandbox/0.1' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const feat = (data.features ?? []).find((f) => f.properties?.level === 'province') ?? data.features?.[0];
      if (!feat) throw new Error('未找到台湾省轮廓');
      return feat;
    } catch (e) {
      if (attempt === 5) throw e;
      console.warn(`  台湾抓取失败（${e.message}），重试 ${attempt}/5`);
      await sleep(800 * attempt);
    }
  }
  throw new Error('台湾抓取失败');
}

async function main() {
  const raw = JSON.parse(readFileSync(CITIES, 'utf8'));
  const features = raw.features ?? [];

  // 已存在则跳过
  if (features.some((f) => String(f.properties?.id) === '710000')) {
    console.log('· cities.geojson 已含台湾省，跳过');
    return;
  }

  const outline = await fetchTaiwan();
  const feature = {
    type: 'Feature',
    properties: {
      id: '710000',
      name: '台湾省',
      province: '台湾省',
      short: '台',
      indexed: false,
      center: outline.properties?.centroid ?? outline.properties?.center ?? null,
    },
    geometry: outline.geometry,
  };
  features.push(feature);
  writeFileSync(CITIES, JSON.stringify({ type: 'FeatureCollection', features }, null, 0), 'utf8');
  console.log(`· 已写入台湾省轮廓（MultiPolygon，center=${JSON.stringify(feature.properties.center)}）`);
  console.log(`· cities.geojson 现共 ${features.length} 个要素`);
}

main().catch((e) => {
  console.error('写入台湾失败：', e.message);
  process.exit(1);
});
