import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const root = fileURLToPath(new URL('./src/web', import.meta.url));
const outWeb = fileURLToPath(new URL('./dist/web', import.meta.url));
const outStandalone = fileURLToPath(new URL('./dist/standalone', import.meta.url));

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    root,
    base: './',
    publicDir: standalone ? false : 'public',
    plugins: standalone ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
    resolve: {
      alias: {
        '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      },
    },
    build: {
      outDir: standalone ? outStandalone : outWeb,
      emptyOutDir: true,
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: standalone ? 100_000_000 : 4096,
    },
    server: {
      port: 5179,
      strictPort: true,
      proxy: {
        '/api': 'http://127.0.0.1:8790',
        '/healthz': 'http://127.0.0.1:8790',
      },
    },
  };
});
