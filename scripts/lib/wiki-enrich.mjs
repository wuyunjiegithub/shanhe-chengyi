/**
 * 把维基百科条目正文解析成可入库的区县内容字段。
 *
 * 只做「搬运 + 摘取」，不编造：
 *   - oneLiner：正文首句
 *   - history  ：历史沿革 / 历史 段落
 *   - culture  ：文化 / 人文 / 民俗 段落
 *   - features ：风景名胜段落里的景点名
 *   - people   ：著名人物段落里的人物
 *   - tags     ：由正文关键词反推（白名单 8 个）
 *   - spots    ：景点名在维基上有独立条目且坐标落在本区县附近时，才落成可点的景点
 *
 * 配套：scripts/fetch-wiki-content.mjs（抓取）→ scripts/gen-baseline-content.mjs（并入基线）
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SPOT_CACHE_DIR = join(process.cwd(), 'scripts/.cache/wiki-spot');
const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

/* ---------- 段落归类 ---------- */
const SECTION_RULES = [
  ['history', /历史沿革|历史与沿革|建置沿革|沿革|^历史$|历史$/],
  ['attractions', /风景名胜|旅游景点|主要景点|名胜|景区|文物|^景点$|^旅游$/],
  ['people', /著名人物|历史人物|名人|人物|英杰|杰出/],
  ['culture', /文化|人文|民俗|风俗|习俗|节庆|婚俗|风物|遗产|非物质|艺术|饮食|美食|特产|小吃|风味|语言|信俗/],
  ['geography', /地理|自然环境|地形|气候|水文/],
];

/** 把正文按 == 段落 == 切开 */
function splitSections(extract) {
  const lines = (extract ?? '').split('\n');
  const intro = [];
  const sections = new Map();
  let current = '__intro__';
  for (const raw of lines) {
    const line = raw.trim();
    const head = /^==+\s*(.+?)\s*==+$/.exec(line);
    if (head) {
      current = head[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current === '__intro__') intro.push(line);
    else sections.get(current).push(line);
  }
  return { intro: intro.join('\n').trim(), sections };
}

/** 段落名归到字段 */
function classify(title) {
  for (const [field, re] of SECTION_RULES) {
    if (re.test(title)) return field;
  }
  return null;
}

/** 合并所有归到同一字段的段落正文 */
function collect(sections, field) {
  const out = [];
  for (const [title, lines] of sections) {
    if (classify(title) !== field) continue;
    out.push(lines.join('\n'));
  }
  return out.join('\n').trim();
}

/* ---------- 文本清洗 ---------- */

/**
 * 维基 wikitext → 纯文本（保留 == 段落 == 标记与列表符）。
 * 模板 / 引用 / 文件链接 / 表格 / HTML 全部剥掉，只留可读正文。
 */
function toPlain(wt) {
  let s = wt ?? '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<ref[^>]*\/>/gi, '');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<ref[^>]*>[\s\S]*$/gi, '');
  // 模板：先剥内层再剥外层，最多几轮以应对嵌套
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\{\{[^{}]*\}\}/g, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/<[^>]{0,80}>/g, '');
  s = s.replace(/\[\[(?:File|Image|文件|图像):[^\]]*\]\]/gi, '');
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
  s = s.replace(/\[https?:\/\/\S+\]/g, '');
  s = s.replace(/'''?/g, '');
  // 表格行：保留单元格文字
  s = s.replace(/^[ \t]*\|+([^\n]*)$/gm, (line) => {
    const cells = line
      .split('||')
      .map((c) => c.replace(/^\|+/, '').replace(/\[\d+\]/g, '').trim())
      .filter(Boolean);
    return cells.join(' · ');
  });
  s = s.replace(/^[ \t]*[{}!][^\n]*$/gm, '');
  // 收尾：清掉残留的链接 / 文件标记（表格里的图片链接常被拆开，留下的碎片要兜住）
  s = s.replace(/\[\[(?:File|Image|文件|图像):[^\]]*\]?/gi, '');
  s = s.replace(/\[\[|\]\]/g, '');
  s = s.replace(/,,+/g, '，');
  return s;
}

function clean(text) {
  return (text ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\[注[^\]]*\]/g, '')
    .replace(/'''?/g, '')
    .replace(/^[ \t]*[=*#:;·\-|]+[ \t]*/gm, '')
    .replace(/\s*\(\s*[^()]{0,40}\)\s*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 取前 n 个字，尽量断在句号上 */
function head(text, n) {
  const t = clean(text).replace(/\n+/g, '');
  if (!t) return '';
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'));
  const body = stop > n * 0.45 ? cut.slice(0, stop + 1) : cut.replace(/[，、；：]$/, '') + '。';
  return body;
}

/* ---------- 缺段落时的兜底：从正文里挑含特征词的句子 ---------- */
const HISTORY_HINT =
  /\d{3,4}年|[唐宋元明清汉隋晋魏秦]朝|年间|设[县州府郡]|置[县州府郡]|改隶|分属|隶属|县治|州治|割据|时期/;
const CULTURE_HINT =
  /文化|人文|民俗|风俗|习俗|传统|非物质|节庆|婚俗|饮食|特产|风物|书院|祠堂|信俗|民风|方言|技艺/;

function sentences(text) {
  return clean(text)
    .replace(/\n+/g, '')
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 正文里挑出前 max 句含特征词的句子 */
function sentencesWith(text, hint, max = 2) {
  const out = [];
  for (const s of sentences(text)) {
    if (!hint.test(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out.join('');
}

/* ---------- 列表项抽取 ---------- */
function listItems(text) {
  const out = [];
  for (const raw of (text ?? '').split('\n')) {
    const m = /^[*#]+\s*(.+)$/.exec(raw.trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

const NAME_OK = /^[\u4e00-\u9fa5A-Za-z0-9·（）()—\-—· ]{2,20}$/;

/** 从段落里挑景点名：优先列表项，其次正文里的「A、B、C」并列 */
function pickAttractionNames(text, limit = 6) {
  const names = [];
  const seen = new Set();
  const push = (raw) => {
    const name = raw
      .split(/[：:，,。；;、（(]/)[0]
      .replace(/^[的“"「『]/, '')
      .replace(/[”"」』]$/, '')
      .trim();
    if (!name || name.length < 2 || name.length > 18) return;
    if (!NAME_OK.test(name)) return;
    if (/^(其中|境内|另有|以及|还有|著名|主要|其他|相传|据说|现存|今属|四至|边界|范围|坐标|下辖|辖境)/.test(name)) return;
    if (seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  for (const item of listItems(text)) push(item);
  if (names.length < limit) {
    for (const m of (text ?? '').matchAll(/[一-龥A-Za-z0-9]{2,10}(?:、[一-龥A-Za-z0-9]{2,10}){1,7}(?:等)?/g)) {
      if (names.length >= limit) break;
      for (const part of m[0].split('、')) push(part);
    }
  }
  return names.slice(0, limit);
}

/** 从正文里挖「名胜有A、B、C」这类并列景点（很多条目只在导语里提景点） */
function attractionsFromProse(text, limit = 6) {
  const out = [];
  const seen = new Set();
  const re =
    /(?:名胜|景点|景区|古迹|遗址|名山|名园|古村|古镇|旅游区|保护区)[^。！？]{0,30}?([一-龥]{2,10}(?:、[一-龥]{2,10}){1,6})/g;
  for (const m of (text ?? '').matchAll(re)) {
    for (const part of m[1].split('、')) {
      const name = part.trim();
      if (!name || name.length < 2 || name.length > 14) continue;
      if (!NAME_OK.test(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** 从「著名人物」段落里挑人名；备注直接用维基条目原文，不编造身份 */
function pickPeople(text, limit = 4) {
  const out = [];
  const seen = new Set();
  for (const item of listItems(text)) {
    const cleanItem = clean(item);
    const name = cleanItem.split(/[：:，,、（(《]/)[0].trim();
    if (!name || name.length < 2 || name.length > 12) continue;
    if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push([name, cleanItem.slice(0, 48)]);
  }
  return out.slice(0, limit);
}

/* ---------- 标签反推（白名单 8 个） ---------- */
const TAGS = ['古镇', '山水', '博物馆', '寺庙', '亲子', '拍照', '徒步', '历史文化'];
const TAG_RULES = [
  ['博物馆', /博物馆|纪念馆|陈列馆|美术馆|科技馆|展览馆|遗址博物馆/],
  ['寺庙', /佛教|道观|古寺|名寺|禅寺|宝塔|教堂|清真寺|寺庙|宫观|庵/],
  ['古镇', /古镇|古城|老街|徽派|明清古村|古村落|牌坊|祠堂/],
  ['徒步', /徒步|登山|古道|步道|绿道|徒步道|环山/],
  ['亲子', /亲子|游乐园|主题乐园|动物园|植物园|儿童|乐园/],
  ['拍照', /观景|摄影|花海|夜景|日落|打卡|网红/],
  ['山水', /风景区|风景名胜区|瀑布|峡谷|湿地|丹霞|喀斯特|天坑|湖|山/],
  ['历史文化', /文物|遗址|古迹|故居|纪念馆|历史|遗址/],
];
function deriveTags(text) {
  const out = [];
  for (const [tag, re] of TAG_RULES) {
    if (re.test(text)) out.push(tag);
    if (out.length >= 3) break;
  }
  return out;
}

function spotTags(text) {
  const t = deriveTags(text);
  if (t.length) return t.slice(0, 2);
  return ['历史文化'];
}
function suitableFor(text) {
  if (/亲子|乐园|博物馆|动物|植物|儿童/.test(text)) return ['亲子'];
  if (/徒步|登山|峡谷|步道|古道|山|湖/.test(text)) return ['徒步'];
  return ['拍照'];
}
function durationOf(text) {
  if (/风景区|景区|湿地|大峡谷|国家公园/.test(text)) return '半天';
  if (/徒步|登山|步道/.test(text)) return '半天';
  return '1-2小时';
}

/* ---------- 景点坐标缓存 ---------- */
let spotCoordMap = null;
function loadSpotCoords() {
  if (spotCoordMap) return spotCoordMap;
  spotCoordMap = new Map();
  if (!existsSync(SPOT_CACHE_DIR)) return spotCoordMap;
  for (const f of readdirSync(SPOT_CACHE_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const j = JSON.parse(readFileSync(join(SPOT_CACHE_DIR, f), 'utf8'));
      if (j?.title && typeof j.lng === 'number') spotCoordMap.set(j.title, [j.lng, j.lat]);
    } catch {
      /* 忽略坏缓存 */
    }
  }
  return spotCoordMap;
}

/** 两点球面距离（km） */
function distKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/* ---------- 主入口 ---------- */
/**
 * @param {{id:string,name:string,city:string,province:string,title:string|null,extract:string,coords?:number[]}} rec
 *        维基缓存里的一条区县记录
 * @param {number[]} center  区县中心点（边界数据算出的 centroid）
 * @param {number} areaKm2   面积（km²），来自边界多边形
 * @returns {{oneLiner:string,history:string,culture:string,features:string[],people:string[],tags:string[],spots:Array}}
 */
export function parseWikiDistrict(rec, center, areaKm2) {
  const empty = {
    oneLiner: '',
    history: '',
    culture: '',
    features: [],
    people: [],
    tags: [],
    spots: [],
  };
  if (!rec?.extract) return empty;

  const { intro, sections } = splitSections(toPlain(rec.extract));
  const historyRaw = collect(sections, 'history');
  const cultureRaw = collect(sections, 'culture');
  const attractionRaw = collect(sections, 'attractions');
  const peopleRaw = collect(sections, 'people');

  const firstSentence = clean(intro).split(/[。\n]/)[0] ?? '';
  // 正文里已经写了面积就别再补一次（维基的官方面积与边界算出的面积略有出入）
  const areaText = areaKm2 > 0 && !firstSentence.includes('面积') ? `，面积约 ${Math.round(areaKm2)} 平方公里` : '';
  let oneLiner = firstSentence ? `${firstSentence}${areaText}。` : '';

  // 没有专门段落时，从正文里挑含特征词的句子兜底
  const fullText = `${intro}\n${[...sections.values()].join('\n')}`;
  const history = head(historyRaw, 150) || head(sentencesWith(fullText, HISTORY_HINT, 2), 150);
  const culture = head(cultureRaw, 120) || head(sentencesWith(fullText, CULTURE_HINT, 2), 120);
  const features = [
    ...new Set([
      ...pickAttractionNames(attractionRaw, 6),
      ...attractionsFromProse(intro, 5),
      ...pickAttractionNames(intro, 4),
    ]),
  ].slice(0, 8);
  const people = pickPeople(peopleRaw);
  const tags = deriveTags(`${intro} ${historyRaw} ${attractionRaw}`);

  /* 景点：只有维基上有独立条目、且坐标落在本区县 150km 内才落点 */
  const coords = loadSpotCoords();
  const spots = [];
  const used = new Set();
  for (const name of features) {
    if (spots.length >= 3) break;
    const hit = coords.get(name);
    if (!hit) continue;
    if (center && distKm(center, hit) > 150) continue; // 同名地不在本区县，丢掉
    const key = `${name}`;
    if (used.has(key)) continue;
    used.add(key);
    const desc = `${name}位于${rec.province}${rec.city}${rec.name}，是当地对外展示的地标之一。`;
    spots.push({
      id: `wk-${rec.id}-${spots.length}`,
      name,
      lng: +hit[0].toFixed(4),
      lat: +hit[1].toFixed(4),
      summary: desc,
      tags: spotTags(name),
      hot: false,
      suitableFor: suitableFor(name),
      duration: durationOf(name),
    });
  }

  return { oneLiner, history, culture, features, people, tags, spots };
}
