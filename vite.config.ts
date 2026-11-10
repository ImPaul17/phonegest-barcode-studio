import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  const web = mode === 'web';
  return {
    plugins: [
      react(),
      {
        name: 'phonegest-web-static',
        transformIndexHtml(html) {
          return web && command === 'build'
            ? html.replace("connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173", "connect-src 'none'")
                .replace('</head>', '<link rel="icon" href="./favicon.ico" /></head>')
            : html;
        },
        generateBundle() {
          if (!web) return;
          this.emitFile({ type: 'asset', fileName: 'favicon.ico', source: readFileSync(new URL('./assets/phonegest.ico', import.meta.url)) });
          this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: readFileSync(new URL('./THIRD-PARTY-NOTICES.txt', import.meta.url)) });
        },
      },
    ],
    base: web ? '/phonegest-barcode-studio/' : './',
    build: { outDir: web ? 'dist-web' : 'dist', emptyOutDir: true },
  };
});
