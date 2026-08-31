import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@nextgendial/shared-types': resolve(__dirname, '../../packages/shared-types/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /api calls to the local Wrangler dev server during development
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          webrtc: ['@telnyx/webrtc']
        }
      }
    }
  },
});
