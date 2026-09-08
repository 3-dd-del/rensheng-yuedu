import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 48123,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 48123,
    strictPort: true
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false
  }
});
