import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Dev: Vite on 127.0.0.1:8717 proxies /api to the REST server on 127.0.0.1:8716 (prototype 11 uses 8765). */
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 8717, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8716' } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 }
});
