import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5055',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  define: {
    // Expose VITE_API_URL at build time (set in Vercel env vars)
    // Falls back to '' (same-origin) for local dev and Railway deploys
    __API_URL__: JSON.stringify(process.env.VITE_API_URL || ''),
  },
});
