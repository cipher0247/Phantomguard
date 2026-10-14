/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { globals: true, environment: 'jsdom', setupFiles: ['tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'] },
});
