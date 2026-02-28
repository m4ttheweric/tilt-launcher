# Publishing Guide

This repo publishes two npm packages under the `@tilt-launcher` org:

| Package                                                                          | Description                                           |
| -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`@tilt-launcher/sdk`](https://www.npmjs.com/package/@tilt-launcher/sdk)         | Core SDK — Tilt process manager, config, status types |
| [`@tilt-launcher/sidecar`](https://www.npmjs.com/package/@tilt-launcher/sidecar) | Standalone executable + typed JSON-RPC client         |

## Quick Publish

```bash
bun run publish:patch   # 1.2.0 → 1.2.1
bun run publish:minor   # 1.2.0 → 1.3.0
bun run publish:major   # 1.2.0 → 2.0.0
bun run publish:dry     # full pipeline, skip actual publish
```

## What the Script Does

`publish-packages.ts` runs the full pipeline automatically:

1. **Type-check** — `tsc --noEmit` on both packages
2. **Lint** — ESLint across the entire monorepo
3. **Format** — Prettier check on all files
4. **Build** — SDK bundle + sidecar binary + client library
5. **Version bump** — updates root + both package.json files
6. **Dep swap** — changes sidecar's `workspace:*` → `^version` for npm
7. **Publish** — SDK first (sidecar depends on it), then sidecar
8. **Restore** — reverts `workspace:*` for local development
9. **Git** — commits version bump and creates `vX.Y.Z` tag

After publish, push:

```bash
git push && git push --tags
```

## Prerequisites

- **npm login**: `npm login` or set token in `~/.npmrc`
- **Org access**: must be a member of the [`@tilt-launcher`](https://www.npmjs.com/org/tilt-launcher) npm org

## First-Time Setup

```bash
# Create an access token at https://www.npmjs.com/settings/YOUR_USER/tokens
# Type: "Publish" (Classic Token)
npm set //registry.npmjs.org/:_authToken=YOUR_TOKEN

# Verify
npm whoami
```

## CI Publishing

The GitHub Action at `.github/workflows/publish-packages.yml` can publish automatically:

1. Set `NPM_TOKEN` in repo secrets (Settings → Secrets → Actions)
2. Go to Actions → "Publish Packages" → Run workflow
3. Select version bump type and optional dry-run

## Dry Run

Always safe to run — validates everything without publishing:

```bash
bun run publish:dry
```

Output:

```
✅ Type-check passed
✅ Lint passed
✅ Format check passed
✅ Build passed
✅ Dry run complete — all checks passed!
```
