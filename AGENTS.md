# Tilt Launcher — Agent Context

## Project overview

Tilt Launcher is a macOS developer tool for managing Tilt development environments. Three layers:

1. **TiltLauncher.swift** — Native macOS menu bar app (▲). Compiled with `swiftc` (no Xcode). Spawns the Node server, provides quick links, preferences UI, server restart, and Launch at Login toggle.

2. **tilt-launcher.mjs** — Zero-dependency Node.js server. Serves the Svelte dashboard from `dist/`, provides REST APIs for start/stop, runs health checks. Supports both HTTP and HTTPS (auto-detects mkcert certs in `.certs/`).

3. **src/** — Svelte 5 + Tailwind CSS v4 + TypeScript 7 dashboard. Built to `dist/` by Vite. Components: App, HealthBar, EnvCard, LogPanel.

## File roles

| File                            | Language    | Purpose                                                                      |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `TiltLauncher.swift`            | Swift 6     | Menu bar app. AppKit, SMAppService for login items. Single file, `swiftc`.   |
| `tilt-launcher.mjs`             | Node.js ESM | HTTPS/HTTP server. Zero npm deps. Reads config from env var or default path. |
| `src/App.svelte`                | Svelte 5    | Root dashboard component. Fetches `/api/config`, polls `/api/status`.        |
| `src/lib/components/`           | Svelte 5    | HealthBar, EnvCard, LogPanel — all typed via `$props()`.                     |
| `src/lib/types.ts`              | TypeScript  | Config, Environment, EnvStatus, StatusResponse interfaces.                   |
| `src/lib/api.ts`                | TypeScript  | Typed fetch wrappers for all API endpoints.                                  |
| `src/lib/utils.ts`              | TypeScript  | `formatUptime()` helper.                                                     |
| `src/app.css`                   | CSS         | Tailwind v4 `@import` + custom `@theme` tokens.                              |
| `config.example.json`           | JSON        | Example config shipped with repo. Copied to user config on first launch.     |
| `build.sh`                      | Bash        | Compiles Swift, bundles server + dist + config into .app/Contents/Resources. |
| `install.sh`                    | Bash        | Full installer: prereqs, deps, build, install, config, optional HTTPS.       |
| `package-dmg.sh`                | Bash        | Creates distributable DMG with Applications symlink.                         |
| `hooks/pre-commit`              | Bash        | 8-check pre-commit hook. Auto-installed via `prepare` script.                |
| `.github/workflows/release.yml` | YAML        | Builds DMGs for arm64 + x86_64, creates GitHub Release on tag push.          |
| `eslint.config.js`              | JS          | ESLint 10 flat config with typescript-eslint strict + eslint-plugin-svelte.  |
| `.prettierrc`                   | JSON        | Prettier with prettier-plugin-svelte + prettier-plugin-tailwindcss.          |
| `tsconfig.json`                 | JSON        | TypeScript 7 native (tsgo) config with strict + noUncheckedIndexedAccess.    |
| `vite.config.js`                | JS          | Vite 7 + @sveltejs/vite-plugin-svelte + @tailwindcss/vite.                   |

## Config

User config: `~/.config/tilt-launcher/config.json` (not in repo).
Swift app passes `TILT_LAUNCHER_CONFIG` env var to Node server.
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
TiltLauncher.swift (menu bar app, /Applications/)
  ├─ reads ~/.config/tilt-launcher/config.json
  ├─ spawns → node <bundle>/Contents/Resources/tilt-launcher.mjs
  │             ├─ serves <bundle>/Contents/Resources/dist/ (Svelte build)
  │             ├─ /api/config, /api/status, /api/start/:id, /api/stop/:id
  │             └─ spawns tilt (detached, survives restarts)
  ├─ menu: dashboard link, per-env tilt + service links
  ├─ preferences window (editable NSTableViews for envs + services)
  └─ Launch at Login toggle (SMAppService.mainApp)
```

## Path resolution (Swift)

Zero hardcoded paths:

- **Resources**: `Bundle.main.resourcePath` (server, dist, config template bundled in .app)
- **Node**: scans nvm versions (newest first), `/opt/homebrew/bin/node`, `/usr/local/bin/node`, falls back to `/usr/bin/env`
- **Config**: always `~/.config/tilt-launcher/config.json`
- **Logs**: `~/.config/tilt-launcher/server.log`

In development (running from repo, not installed .app), falls back to the repo directory.

## HTTP vs HTTPS

Auto-detected: if `.certs/` (in Resources or repo) contains `*-key.pem` + `*.pem`, uses `node:https`. Otherwise `node:http`. No config flag needed.

## Distribution

- **DMG**: `package-dmg.sh` creates `TiltLauncher.dmg` with .app + /Applications symlink
- **GitHub Actions**: on tag push (`v*`), builds for arm64 (macos-15) and x86_64 (macos-13), uploads both DMGs to a GitHub Release
- **Self-contained .app**: server script, Vite dist, and config template bundled in Contents/Resources

## Pre-commit hook

8 checks in two phases, stash-based (checks only staged code):

**Code Quality:**

1. Prettier (formatting)
2. TypeScript types (tsgo --noEmit)
3. ESLint (Svelte + TS strict)
4. Swift types (swiftc -typecheck)
5. SwiftLint (optional, skipped if not installed)
6. Node server syntax (node --check)

**Builds** (both to temp dirs, no side effects): 7. Vite build 8. Swift build

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
./build.sh               # compile Swift + bundle resources
./package-dmg.sh         # create DMG
./install.sh             # full install flow
```

## Coding conventions

- **Swift**: Single-file AppKit app. Frame-based layout. `swiftc` compilation, no SPM/Xcode. macOS 14+. Uses `SMAppService` for login items, `NSTableView` for preferences.
- **Svelte**: `<script lang="ts">`, Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), Tailwind utility classes, keyed `{#each}` blocks.
- **TypeScript**: tsgo (TS7 native) with strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax. `.ts` extensions in imports.
- **Server**: ESM `.mjs`, no TypeScript, zero npm deps at runtime. Config from `TILT_LAUNCHER_CONFIG` env var or `~/.config/` default.
- **Linting**: ESLint 10 flat config with typescript-eslint strict + eslint-plugin-svelte. Prettier with Svelte + Tailwind class sorting.
