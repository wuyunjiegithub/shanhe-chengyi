import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 套壳要点：base 必须是相对路径 './'。
// Tauri 把前端资源嵌进 exe / apk 后，页面是通过自定义协议（tauri:// 系）加载的，
// 绝对根路径 '/assets/...' 在移动端资源协议下会找不着文件。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: './',
  server: { port: 1420, strictPort: true, host: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    // 单文件产物里资源是按相对路径索引的，关掉内联小资源可避免生成额外 data: URI
    assetsInlineLimit: 4096,
  },
  envPrefix: ['VITE_', 'TAURI_'],
});