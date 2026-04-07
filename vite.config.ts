import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// ⚠️  Change this to match your GitHub repository name exactly
// e.g. github.com/yourname/steelopt-bs5950  →  repoName = 'steelopt-bs5950'
const repoName = 'steelopt-bs5950';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? `/${repoName}/` : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
});
