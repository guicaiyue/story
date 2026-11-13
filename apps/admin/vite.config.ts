import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind all interfaces so the dev server is reachable from outside the
    // container (the DSH dev container is not the browser's localhost).
    host: true,
    // 03-decisions D7: the dev server talks to the local M1 API on :3000,
    // which in turn points at the isolated story_dev database.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Ant Design 的 Modal / Popconfirm 在 jsdom 里要渲染门户并跑动画，单次交互
    // 实测约 5s，默认 5s 超时会随机失败。放宽到 20s。
    testTimeout: 20000,
  },
});
