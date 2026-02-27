#!/usr/bin/env bun

import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { intro, outro, spinner, log } from '@clack/prompts';

const DIR = import.meta.dir;
const CONFIG_DIR = join(homedir(), '.config', 'tilt-launcher');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

// ── Helpers ──────────────────────────────────────────────────────────

function sh(
  cmd: string,
  args: string[],
  opts: { silent?: boolean; check?: boolean; cwd?: string } = {},
): { status: number; output: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? DIR,
    encoding: 'utf-8',
    stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  const output = opts.silent ? ((result.stdout ?? '') + (result.stderr ?? '')).trim() : '';
  if (opts.check !== false && result.status !== 0) {
    log.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
  return { status: result.status ?? 1, output };
}

function which(cmd: string): string | null {
  const r = spawnSync('command', ['-v', cmd], { shell: true, encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ── Intro ─────────────────────────────────────────────────────────────

console.log();
intro('▲ Tilt Launcher Installer');

// ── Prerequisites ─────────────────────────────────────────────────────

log.step('Checking prerequisites...');

const missing: string[] = [];
for (const cmd of ['bun', 'tilt']) {
  const path = which(cmd);
  if (path) {
    log.success(`${cmd} found: ${path}`);
  } else {
    log.error(`${cmd} not found`);
    missing.push(cmd);
  }
}

if (missing.length > 0) {
  log.error('Missing prerequisites. Install them and re-run:');
  if (missing.includes('bun')) console.log('    brew install oven-sh/bun/bun');
  if (missing.includes('tilt')) console.log('    brew install tilt-dev/tap/tilt');
  console.log();
  process.exit(1);
}

// ── Install dependencies ──────────────────────────────────────────────

const depsSpinner = spinner();
depsSpinner.start('Installing dependencies...');
sh('bun', ['install'], { silent: true });
depsSpinner.stop('Dependencies installed');

// ── Build dashboard ───────────────────────────────────────────────────

const buildSpinner = spinner();
buildSpinner.start('Building dashboard...');
sh('bun', ['run', 'build'], { silent: true });
buildSpinner.stop('Dashboard built');

// ── Package Electron app ───────────────────────────────────────────────

const packageSpinner = spinner();
const arch = process.arch === 'x64' ? 'x64' : 'arm64';
const appBundle = join(DIR, 'dist-app', `TiltLauncher-darwin-${arch}`, 'TiltLauncher.app');
packageSpinner.start(`Packaging Electron app (${arch})...`);
sh('bun', ['run', 'package:app', '--arch', arch], { silent: true });
packageSpinner.stop('Electron app packaged');

// ── Install to /Applications ──────────────────────────────────────────

const installSpinner = spinner();
installSpinner.start('Installing to /Applications...');
sh('rm', ['-rf', '/Applications/TiltLauncher.app'], { silent: true });
sh('cp', ['-r', appBundle, '/Applications/'], { silent: true });
sh('xattr', ['-cr', '/Applications/TiltLauncher.app'], { silent: true, check: false });
installSpinner.stop('Installed to /Applications/TiltLauncher.app');

// ── Create config if not exists ───────────────────────────────────────

mkdirSync(CONFIG_DIR, { recursive: true });
if (!existsSync(CONFIG_PATH)) {
  copyFileSync(join(DIR, 'config.example.json'), CONFIG_PATH);
  log.info(`Config created at ${CONFIG_PATH}`);
} else {
  log.info(`Config already exists at ${CONFIG_PATH}`);
}

// ── Done ──────────────────────────────────────────────────────────────

let dashboardUrl = 'http://localhost:10400';
try {
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  dashboardUrl = cfg.dashboardUrl ?? dashboardUrl;
} catch {}

console.log();
console.log(`  Config:    ${CONFIG_PATH}`);
console.log(`  Dashboard: ${dashboardUrl}`);
console.log();
console.log('  To launch:    open /Applications/TiltLauncher.app');
console.log('  To auto-start: System Settings → General → Login Items');
console.log();

outro('Tilt Launcher installed!');
