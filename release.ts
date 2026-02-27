#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { intro, outro, select, isCancel, cancel, spinner, log } from '@clack/prompts';

const DIR = import.meta.dir;
process.chdir(DIR);

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

// ── Helpers ──────────────────────────────────────────────────────────

function sh(
  cmd: string,
  args: string[],
  opts: { silent?: boolean; check?: boolean } = {},
): { status: number; output: string } {
  const result = spawnSync(cmd, args, {
    cwd: DIR,
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

// ── Load version ─────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf-8'));
const current: string = pkg.version;
const [major, minor, patch] = current.split('.').map(Number);

// ── Intro ─────────────────────────────────────────────────────────────

console.log();
intro(`▲ Tilt Launcher Release${isDryRun ? '  (dry run)' : ''}`);

// ── Pick bump type ────────────────────────────────────────────────────

const choice = await select({
  message: `Current version is v${current} — release as:`,
  options: [
    { value: `${major}.${minor}.${patch + 1}`, label: `patch  v${major}.${minor}.${patch + 1}`, hint: 'bug fixes' },
    { value: `${major}.${minor + 1}.0`, label: `minor  v${major}.${minor + 1}.0`, hint: 'new features' },
    { value: `${major + 1}.0.0`, label: `major  v${major + 1}.0.0`, hint: 'breaking changes' },
    { value: current, label: `keep   v${current}`, hint: 'already bumped manually' },
  ],
});

if (isCancel(choice)) {
  cancel('Release cancelled.');
  process.exit(0);
}

const newVersion = choice as string;

// ── Checks ───────────────────────────────────────────────────────────

const dirty =
  sh('git', ['diff', '--quiet'], { silent: true, check: false }).status !== 0 ||
  sh('git', ['diff', '--cached', '--quiet'], { silent: true, check: false }).status !== 0;

if (dirty) {
  log.error('Working tree has uncommitted changes. Commit or stash them first.');
  process.exit(1);
}
log.success('Working tree clean');

const branch = sh('git', ['branch', '--show-current'], { silent: true }).output;
if (branch !== 'main') {
  log.error(`Not on main branch (on: ${branch})`);
  process.exit(1);
}
log.success('On main branch');

const s = spinner();
s.start('Running checks...');
const checks = spawnSync('bash', [join(DIR, 'hooks/pre-commit')], {
  cwd: DIR,
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (checks.status !== 0) {
  s.stop('Checks failed');
  if (checks.stdout) console.log(checks.stdout);
  if (checks.stderr) console.error(checks.stderr);
  log.error('Fix the issues above and try again.');
  process.exit(1);
}
s.stop('All checks passed');

// ── Dry run ───────────────────────────────────────────────────────────

if (isDryRun) {
  log.info(
    newVersion !== current
      ? `Would bump to v${newVersion}, commit, tag, and push.`
      : `Would keep v${current}, tag, and push (no bump commit).`,
  );
  outro(`Dry run passed — run without --dry-run to release for real.`);
  process.exit(0);
}

// ── Bump ─────────────────────────────────────────────────────────────

if (newVersion !== current) {
  const bs = spinner();
  bs.start(`Bumping to v${newVersion}...`);

  const pkgRaw = readFileSync(join(DIR, 'package.json'), 'utf-8');
  writeFileSync(join(DIR, 'package.json'), pkgRaw.replace(`"version": "${current}"`, `"version": "${newVersion}"`));

  sh('git', ['add', 'package.json']);
  sh('git', ['commit', '-m', `v${newVersion}`, '--no-verify']);
  bs.stop(`Bumped package.json`);
} else {
  log.info(`Keeping current version v${current}`);
}

// ── Tag and push ──────────────────────────────────────────────────────

const ps = spinner();
ps.start('Tagging and pushing...');
sh('git', ['tag', `v${newVersion}`]);
sh('git', ['push', 'origin', 'main', `v${newVersion}`]);
ps.stop(`Pushed v${newVersion}`);

// ── Done ──────────────────────────────────────────────────────────────

outro(`Release v${newVersion} triggered! GitHub Actions is building the DMGs.`);
console.log(`  https://github.com/m4ttheweric/tilt-launcher/releases/tag/v${newVersion}\n`);
