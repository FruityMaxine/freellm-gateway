import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// Backend bound to 127.0.0.1:3001 per project rule. Dev proxy bridges /v1/* and /admin/*.
const API_TARGET = process.env.FREELLM_API_BASE_URL ?? 'http://127.0.0.1:3001';
// 版本号 single source of truth：build 时从根 VERSION 文件注入，禁止前端硬编码（组 4 Tick 3）。
const APP_VERSION = readFileSync(
  fileURLToPath(new URL('../../VERSION', import.meta.url)),
  'utf-8',
).trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': { target: API_TARGET, changeOrigin: true },
      '/admin': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
      '/ready': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 主 bundle 拆分：v1.0.0.0 Tick 15 引入。
        // 原单 chunk 1.13 MB → 拆分后主包显著降，gzip 后初次加载更快。
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          framer: ['framer-motion'],
          charts: ['recharts'],
          radix: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-slot',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          query: ['@tanstack/react-query', 'axios'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});
