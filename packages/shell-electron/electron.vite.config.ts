import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const uiDir = resolve(__dirname, '../ui');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, 'out/main'),
      lib: {
        entry: resolve(__dirname, 'src/main.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve(__dirname, 'out/preload'),
      lib: {
        entry: resolve(__dirname, 'src/preload.ts'),
      },
    },
  },
  renderer: {
    root: uiDir,
    server: {
      port: 5200,
    },
    resolve: {
      alias: {
        $lib: resolve(uiDir, 'src/lib'),
      },
    },
    plugins: [svelte(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(uiDir, 'index.html'),
      },
    },
  },
});
