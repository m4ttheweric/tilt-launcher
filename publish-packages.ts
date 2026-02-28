#!/usr/bin/env bun
/**
 * Unified publish script for @tilt-launcher/* packages.
 *
 * Handles version bumping, pre-publish checks, building, and npm publish
 * for both SDK and sidecar packages in one command.
 *
 * Usage:
 *   bun publish-packages.ts patch          # 1.2.0 → 1.2.1
 *   bun publish-packages.ts minor          # 1.2.0 → 1.3.0
 *   bun publish-packages.ts major          # 1.2.0 → 2.0.0
 *   bun publish-packages.ts --dry-run      # run checks and build, but don't publish
 *   bun publish-packages.ts 1.5.0          # explicit version
 */

import { $ } from 'bun';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = [
  { name: '@tilt-launcher/sdk', dir: 'packages/sdk' },
  { name: '@tilt-launcher/sidecar', dir: 'packages/sidecar' },
];

const ROOT_PKG = 'package.json';

// ── Parse args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => !a.startsWith('--'));

if (!bumpArg && !dryRun) {
  console.log(`
Usage: bun publish-packages.ts <patch|minor|major|x.y.z> [--dry-run]

Examples:
  bun publish-packages.ts patch       # 1.2.0 → 1.2.1
  bun publish-packages.ts minor       # 1.2.0 → 1.3.0
  bun publish-packages.ts 2.0.0       # explicit version
  bun publish-packages.ts --dry-run   # checks only, no publish
`);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────

function readVersion(pkgPath: string): string {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function bumpVersion(current: string, bump: string): string {
  if (/^\d+\.\d+\.\d+/.test(bump)) return bump; // explicit version

  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'patch':
      return `${major}.${minor}.${patch! + 1}`;
    case 'minor':
      return `${major}.${minor! + 1}.0`;
    case 'major':
      return `${major! + 1}.0.0`;
    default:
      throw new Error(`Unknown bump type: ${bump}`);
  }
}

function setVersion(pkgPath: string, version: string): void {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function header(msg: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${msg}`);
  console.log(`${'─'.repeat(60)}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const currentVersion = readVersion(ROOT_PKG);
  const nextVersion = bumpArg ? bumpVersion(currentVersion, bumpArg) : currentVersion;

  header(`Publishing ${currentVersion} → ${nextVersion}${dryRun ? ' (dry run)' : ''}`);

  // Step 1: Type-check
  header('Step 1/5: Type-checking packages');
  await $`bun run check:packages`.throws(true);
  console.log('✅ Type-check passed');

  // Step 2: Lint
  header('Step 2/5: Linting');
  await $`bun run lint`.throws(true);
  console.log('✅ Lint passed');

  // Step 3: Format check
  header('Step 3/5: Format check');
  await $`bun run format:check`.throws(true);
  console.log('✅ Format check passed');

  // Step 4: Build
  header('Step 4/5: Building packages');
  await $`bun run build:packages`.throws(true);
  console.log('✅ Build passed');

  // Step 5: Version bump + publish
  if (dryRun) {
    header('Step 5/5: Dry run — skipping version bump and publish');
    console.log(`  Would bump: ${currentVersion} → ${nextVersion}`);
    console.log(`  Would publish: ${PACKAGES.map((p) => p.name).join(', ')}`);
    console.log('\n✅ Dry run complete — all checks passed!\n');
    return;
  }

  header(`Step 5/5: Bumping version to ${nextVersion} and publishing`);

  // Bump root
  setVersion(ROOT_PKG, nextVersion);
  console.log(`  ✓ root → ${nextVersion}`);

  // Bump each package
  for (const pkg of PACKAGES) {
    const pkgPath = join(pkg.dir, 'package.json');
    setVersion(pkgPath, nextVersion);
    console.log(`  ✓ ${pkg.name} → ${nextVersion}`);
  }

  // Update sidecar's dependency on SDK from workspace:* to the actual version for npm
  const sidecarPkgPath = join('packages/sidecar', 'package.json');
  const sidecarPkg = JSON.parse(readFileSync(sidecarPkgPath, 'utf-8'));
  const originalDep = sidecarPkg.dependencies['@tilt-launcher/sdk'];
  sidecarPkg.dependencies['@tilt-launcher/sdk'] = `^${nextVersion}`;
  writeFileSync(sidecarPkgPath, JSON.stringify(sidecarPkg, null, 2) + '\n');

  try {
    // Publish SDK first (sidecar depends on it)
    console.log(`\n  Publishing ${PACKAGES[0]!.name}...`);
    await $`cd ${PACKAGES[0]!.dir} && npm publish --access public`.throws(true);
    console.log(`  ✅ ${PACKAGES[0]!.name}@${nextVersion} published`);

    // Publish sidecar
    console.log(`\n  Publishing ${PACKAGES[1]!.name}...`);
    await $`cd ${PACKAGES[1]!.dir} && npm publish --access public`.throws(true);
    console.log(`  ✅ ${PACKAGES[1]!.name}@${nextVersion} published`);
  } finally {
    // Restore workspace:* dep for local development
    sidecarPkg.dependencies['@tilt-launcher/sdk'] = originalDep;
    writeFileSync(sidecarPkgPath, JSON.stringify(sidecarPkg, null, 2) + '\n');
  }

  // Git commit + tag
  console.log('\n  Creating git commit and tag...');
  await $`git add -A`.quiet();
  await $`git commit -m "chore: release v${nextVersion}"`.quiet();
  await $`git tag v${nextVersion}`.quiet();
  console.log(`  ✓ Tagged v${nextVersion}`);

  console.log(`\n✅ Published @tilt-launcher/sdk@${nextVersion} and @tilt-launcher/sidecar@${nextVersion}!\n`);
  console.log(`  Don't forget: git push && git push --tags\n`);
}

main().catch((e) => {
  console.error('\n❌ Publish failed:', e.message ?? e);
  process.exit(1);
});
