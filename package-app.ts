#!/usr/bin/env bun

import { packager } from '@electron/packager';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const DIR = import.meta.dir;
const OUT_DIR = join(DIR, 'dist-app');

function parseArg(name: string): string | undefined {
  const pair = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (pair) return pair.split('=').slice(1).join('=');
  const idx = process.argv.findIndex((arg) => arg === name);
  if (idx >= 0) return process.argv[idx + 1];
  return undefined;
}

const requestedArch = parseArg('--arch');
let arch: 'x64' | 'arm64';
if (!requestedArch) {
  arch = process.arch === 'x64' ? 'x64' : 'arm64';
} else if (requestedArch === 'x64' || requestedArch === 'arm64') {
  arch = requestedArch;
} else {
  throw new Error(`Unsupported arch '${requestedArch}'. Use --arch arm64 or --arch x64.`);
}

const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf-8')) as { version: string };
const iconBasePath = join(DIR, 'AppIcon');
const iconPath = `${iconBasePath}.icns`;

rmSync(OUT_DIR, { recursive: true, force: true });

// Ensure Electron entrypoints exist even after local artifact cleanup.
await $`bunx electron-vite build`;

const bundled = await packager({
  dir: DIR,
  out: OUT_DIR,
  platform: 'darwin',
  arch,
  name: 'TiltLauncher',
  overwrite: true,
  prune: true,
  asar: true,
  appBundleId: 'dev.tilt-launcher',
  appVersion: pkg.version,
  buildVersion: pkg.version,
  ignore: [/^\/\.git/, /^\/\.cursor/, /^\/agent-transcripts/, /^\/dist-app/, /^\/TiltLauncher\.app/],
});

if (bundled.length === 0) {
  throw new Error('Electron packager did not output an app bundle.');
}

if (existsSync(iconPath)) {
  for (const appPath of bundled) {
    const bundleRoot = appPath.endsWith('.app') ? appPath : join(appPath, 'TiltLauncher.app');
    const targetIcon = join(bundleRoot, 'Contents', 'Resources', 'electron.icns');
    copyFileSync(iconPath, targetIcon);
  }
}

console.log(bundled[0]);
