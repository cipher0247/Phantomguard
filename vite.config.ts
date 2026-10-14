/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { globals: true, environment: 'jsdom', setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'] },
});
