# Tilt Launcher — Agent Context

## Project overview

Tilt Launcher is a single Electron app for managing Tilt development environments.

- `src/main/index.ts`: Electron main process (tray/menu, IPC, process orchestration)
- `src/preload/index.ts`: secure IPC bridge
- `src/App.svelte`: dashboard/settings renderer UI

## File roles

| File                            | Language   | Purpose                                                                     |
| ------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `src/main/index.ts`             | TypeScript | Electron main: tray, window lifecycle, Tilt orchestration, config IO.       |
| `src/preload/index.ts`          | TypeScript | IPC bridge exposed as `window.tiltLauncher`.                                |
| `src/App.svelte`                | Svelte 5   | Dashboard/settings UI for env management, logs, discovery, preferences.     |
| `src/lib/types.ts`              | TypeScript | Config, environment, status, and IPC-related interfaces.                    |
| `src/lib/api.ts`                | TypeScript | Typed wrappers around preload bridge methods.                               |
| `src/lib/utils.ts`              | TypeScript | `formatUptime()` helper.                                                    |
| `src/app.css`                   | CSS        | Tailwind v4 `@import` + custom `@theme` tokens.                             |
| `config.example.json`           | JSON       | Example config shipped with repo. Copied to user config on first launch.    |
| `package-app.ts`                | TypeScript | Packages macOS `.app` via electron-packager.                                |
| `install.ts`                    | TypeScript | Local install flow: deps, build, package, copy to `/Applications`.          |
| `package-dmg.sh`                | Bash       | Creates distributable DMG with Applications symlink.                        |
| `hooks/pre-commit`              | Bash       | 8-check pre-commit hook. Auto-installed via `prepare` script.               |
| `.github/workflows/release.yml` | YAML       | Builds DMGs for arm64 + x86_64, creates GitHub Release on tag push.         |
| `eslint.config.js`              | JS         | ESLint 10 flat config with typescript-eslint strict + eslint-plugin-svelte. |
| `.prettierrc`                   | JSON       | Prettier with prettier-plugin-svelte + prettier-plugin-tailwindcss.         |
| `tsconfig.json`                 | JSON       | TypeScript 7 native (tsgo) config with strict + noUncheckedIndexedAccess.   |
| `vite.config.js`                | JS         | Vite 7 + @sveltejs/vite-plugin-svelte + @tailwindcss/vite.                  |

## Config

User config: `~/.config/tilt-launcher/config.json` (not in repo).
First launch copies `config.example.json` if no user config exists.

```json
{
  "port": "number — server port (default 10400)",
  "dashboardUrl": "string — URL for Open Dashboard action",
  "environments": [
    {
      "id": "string — unique ID, used in API routes and health keys",
      "name": "string — display name in menu and dashboard",
      "repoDir": "string — absolute path to repo containing Tiltfile",
      "tiltfile": "string — Tiltfile name relative to repoDir",
      "tiltPort": "number — Tilt dashboard port (unique per env)",
      "description": "string — shown in dashboard card",
      "services": [{ "id": "string", "label": "string", "port": "number", "path": "string" }]
    }
  ]
}
```

Each environment is self-contained. Services are per-environment. Health keys: `envId:serviceId`.

## Architecture

```
Electron main (src/main/index.ts)
  ├─ reads/writes ~/.config/tilt-launcher/config.json
  ├─ owns tray menu + dashboard window lifecycle
  ├─ starts/stops tilt (detached) and captures logs
  ├─ polls discovered resources + health
  └─ emits status snapshots over IPC

Preload bridge (src/preload/index.ts)
  └─ exposes typed `window.tiltLauncher` APIs

Renderer (src/App.svelte)
  └─ launchpad + settings UI
```

## Distribution

- **DMG**: `package-dmg.sh` creates `TiltLauncher.dmg` with .app + /Applications symlink
- **GitHub Actions**: on tag push (`v*`), builds arm64 + x86_64 Electron bundles and uploads both DMGs to GitHub Release
- **Self-contained .app**: packaged via `@electron/packager`

## Pre-commit hook

Checks are stash-based (checks only staged code):

**Code Quality:**

1. Prettier (formatting)
2. TypeScript types (tsgo --noEmit)
3. ESLint (Svelte + TS strict)
4. Electron app package check (`bun run package:app`)

**Builds**: Vite build + Electron package build

Auto-installed via `prepare` script on `bun install`. Skip with `--no-verify`.

## Build commands

```bash
bun install              # deps + install pre-commit hook
bun run dev              # vite HMR dev server
bun run build            # tsgo + eslint + vite build
bun run check            # tsgo --noEmit
bun run lint             # eslint src/
bun run lint:fix         # eslint --fix
bun run format           # prettier --write
bun run format:check     # prettier --check
bun run package:app      # package .app (electron-packager)
bun run install:app      # package + install to /Applications
bun run test:sdk         # run E2E tests for TiltManagerSDK (~3-5 min)
./package-dmg.sh <app-bundle-path> [output-dmg-path]
```

## E2E Tests

`tests/sdk.e2e.test.ts` — comprehensive integration tests for `TiltManagerSDK`.

**Requires**: `tilt` and `python3` on `$PATH`.

```bash
bun run test:sdk
```

Four suites, each spins up a real `tilt` process against a fixture in `tests/fixtures/`:

| Suite            | Fixture                          | Covers                                                                                                                                                          |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic`          | `tests/fixtures/basic/`          | lifecycle, discovery, kinds, health, logs, trigger, enable/disable, new UIResource fields (updateStatus, lastDeployTime, buildDuration, pid, conditions, order) |
| `multi-resource` | `tests/fixtures/multi-resource/` | multi-resource discovery, category labels, concurrent triggers, restart, stop                                                                                   |
| `slow-build`     | `tests/fixtures/slow-build/`     | build duration measurement, updateStatus lifecycle                                                                                                              |
| `dependencies`   | `tests/fixtures/dependencies/`   | resource_deps ordering, dependency resolution, serve pid                                                                                                        |

Ports used (must be free): **19100**, **19200**, **19300**, **19400** (Tilt dashboards), **18765**, **18766**, **18767** (fixture HTTP servers).

## Coding conventions

- **Svelte**: `<script lang="ts">`, Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), Tailwind utility classes, keyed `{#each}` blocks.
- **TypeScript**: tsgo (TS7 native) with strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax. `.ts` extensions in imports.
- **Main process**: keep lifecycle logic centralized in `src/main/index.ts`; prefer explicit save-driven config persistence.
- **Linting**: ESLint 10 flat config with typescript-eslint strict + eslint-plugin-svelte. Prettier with Svelte + Tailwind class sorting.
