import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    root: '.',
    server: {
      // Use an ephemeral dev port to avoid collisions with Tilt/service ports.
      port: 5200,
    },
    resolve: {
      alias: {
        $lib: resolve('./src/lib'),
      },
    },
    plugins: [svelte(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: resolve('./index.html'),
      },
    },
  },
});
