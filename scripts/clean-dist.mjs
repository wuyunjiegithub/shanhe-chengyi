// 构建前清理 dist。
// vite.config.ts 里 emptyOutDir 被关掉了（内置的递归删除在受控环境会被拦截），
// 但 build 脚本没有对应的清理步骤 → 每次构建的 index-*.js / *.css 都堆在 dist/assets 里，
// 内嵌进 exe / apk 后包体一路膨胀（同一份前端被塞进几十个 hash 文件）。
// 这里只删已知的产物目录与入口文件，不做整目录递归删除，避免误伤。
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['dist/assets', 'dist/index.html'];

for (const rel of targets) {
  const p = join(root, rel);
  if (!existsSync(p)) continue;
  try {
    rmSync(p, { recursive: true, force: true });
    console.log(`已清理 ${rel}`);
  } catch (err) {
    // 清理失败不阻断构建：多几个历史文件不致命，包体大一点而已
    console.warn(`清理 ${rel} 失败（继续构建）：${err instanceof Error ? err.message : err}`);
  }
}
