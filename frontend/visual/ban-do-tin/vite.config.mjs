// Dựng khung so ảnh ở chế độ PRODUCTION (đo ngân sách ≤ 50 ms/click đúng như bản thật, không có overhead dev).
//   npx vite build --config visual/ban-do-tin/vite.config.mjs && npx vite preview --config visual/ban-do-tin/vite.config.mjs --port 5292
//   node visual/ban-do-tin/chup.mjs --url http://localhost:5292
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import goc from '../../vite.config.ts';

export default mergeConfig(goc, defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist-xem', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: { input: fileURLToPath(new URL('./xem.html', import.meta.url)) },
  },
}));
