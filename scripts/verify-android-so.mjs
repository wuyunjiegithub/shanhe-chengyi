/**
 * 安卓 .so 内嵌资源校验（防「打不开网页」事故复发）
 *
 * 背景：tauri-macros 里 dev 判定是 `cfg!(not(feature = "custom-protocol"))`。
 * 手动 `cargo ndk build --release` 若漏掉 `--features custom-protocol`，
 * Rust 侧会当成 dev 构建：不内嵌前端资源，运行时改去请求 devUrl，
 * 手机上的表现就是「Failed to request http://localhost:1420/」白屏。
 *
 * 校验方式：dist/assets 里被 index.html 引用的 js/css 文件名（资源键名是明文，
 * 内容被压缩）必须出现在 .so 的字节流里；再抽查 content / geo 目录。
 *
 * 用法：npm run android:verify
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const soPath = join(
  root,
  'src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libshanhe_chengyi_lib.so',
);
const distDir = join(root, 'dist');

const fail = [];
const ok = [];

function check(label, okFlag, hint) {
  (okFlag ? ok : fail).push(okFlag ? label : `${label} —— ${hint}`);
}

if (!existsSync(soPath)) {
  console.error(`✗ 找不到 .so：${soPath}`);
  process.exit(1);
}
if (!existsSync(join(distDir, 'index.html'))) {
  console.error('✗ 找不到 dist/index.html，请先 npm run build');
  process.exit(1);
}

const so = readFileSync(soPath);
const html = readFileSync(join(distDir, 'index.html'), 'utf8');

// 1. index.html 引用的 js / css 必须内嵌
const refs = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
if (refs.length === 0) fail.push('index.html 里没解析到任何 assets 引用，脚本规则需要更新');
for (const ref of refs) {
  const key = `dist/${ref}`; // EmbeddedAssets 的键名去掉了 dist 前缀，这里用文件名匹配
  const name = ref.split('/').pop();
  check(`内嵌 ${ref}`, so.includes(Buffer.from(name, 'utf8')), `.so 里没有资源键 "${name}"（${key}）`);
}

// 2. dist/assets 目录下的产物也逐个比对（防止 index.html 漏引用）
const assetsDir = join(distDir, 'assets');
if (existsSync(assetsDir)) {
  for (const f of readdirSync(assetsDir)) {
    if (refs.some((r) => r.endsWith(f))) continue; // 第 1 步已查过
    check(`内嵌 assets/${f}`, so.includes(Buffer.from(f, 'utf8')), `.so 里没有 "${f}"`);
  }
}

// 3. 抽查数据文件（资源键是相对路径，明文）
for (const key of ['content/cities.json', 'geo/districts']) {
  check(`内嵌 ${key}`, so.includes(Buffer.from(key, 'utf8')), `.so 里没有数据资源 "${key}"`);
}

// 4. 体积兜底：只编 Rust 不内嵌前端时 .so 约 5.3MB，内嵌后应明显变大
const mb = (so.length / 1024 / 1024).toFixed(2);
check(`.so 体积 ${mb}MB`, so.length > 5.8 * 1024 * 1024, '体积偏小，高度怀疑没走 custom-protocol');

console.log(`\n.so：${soPath}（${mb}MB）`);
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of fail) console.error(`  ✗ ${line}`);

if (fail.length) {
  console.error(
    `\n✗ 校验失败 ${fail.length} 项。八成是编译时漏了 --features custom-protocol：\n` +
      '  cd src-tauri\n' +
      '  cargo ndk -t arm64-v8a --platform 24 build --release --features custom-protocol\n' +
      '  cp target/aarch64-linux-android/release/libshanhe_chengyi_lib.so gen/android/app/src/main/jniLibs/arm64-v8a/\n',
  );
  process.exit(1);
}
console.log(`\n✓ 通过（${ok.length} 项）：前端资源已内嵌，不是 dev 模式构建。`);
