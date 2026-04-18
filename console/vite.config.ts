import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@middleware': path.resolve(__dirname, '../src/middleware/mfosDecision.ts'),
      '@fixtures': path.resolve(__dirname, '../fixtures/mfos_ground_truth_v1_4_1.json')
    }
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});
