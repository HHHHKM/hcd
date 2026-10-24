import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/healthz': { target: 'http://localhost:3000', changeOrigin: false },
      '/.well-known': { target: 'http://localhost:3000', changeOrigin: false },
      '^/oauth/(authorize|token|register|revoke)(?:[?]|$)': { target: 'http://localhost:3000', changeOrigin: false },
      '/mcp': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
