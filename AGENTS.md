# Tilt Launcher — Agent Context

## Project overview

Tilt Launcher is a macOS developer tool for managing Tilt development environments. Two components:

1. **TiltLauncher.swift** — Native macOS menu bar app (▲). Compiled with `swiftc` (no Xcode). Spawns the Node server, shows quick links, has a preferences UI.

2. **tilt-launcher.mjs** — Zero-dependency Node.js server. Serves a Svelte dashboard, provides REST APIs for start/stop, runs health checks. Supports both HTTP and HTTPS (auto-detects certs).

The web frontend is built with Svelte 5 + Tailwind CSS v4 + TypeScript 7 (native preview) + Vite 7.

## Key files

| File                  | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `TiltLauncher.swift`  | Menu bar app. AppKit/Cocoa, no Xcode project.                        |
| `tilt-launcher.mjs`   | Node.js server. Zero npm deps at runtime.                            |
| `src/`                | Svelte 5 dashboard (compiled to `dist/` by Vite)                     |
| `config.example.json` | Example config, shipped with the repo                                |
| `build.sh`            | Compiles Swift into `.app` bundle, injects repo path into Info.plist |
| `install.sh`          | One-step installer (deps, build, install, config, optional HTTPS)    |

## Config location

User config lives at `~/.config/tilt-launcher/config.json` (not in the repo). The Swift app passes `TILT_LAUNCHER_CONFIG` env var to the Node server. If no user config exists, the app copies `config.example.json` on first launch.

## config.json schema

```json
{
  "port": "number — server port (default 10400)",
  "dashboardUrl": "string — URL for the dashboard",
  "environments": [
    {
      "id": "string — unique ID",
      "name": "string — display name",
      "repoDir": "string — absolute path to repo with Tiltfile",
      "tiltfile": "string — Tiltfile name relative to repoDir",
      "tiltPort": "number — Tilt dashboard port (unique per env)",
      "description": "string — shown in UI",
      "services": [{ "id": "string", "label": "string", "port": "number", "path": "string" }]
    }
  ]
}
```

Each environment is fully self-contained. Services are per-environment. Health keys use `envId:serviceId`.

## Architecture

```
TiltLauncher.swift (menu bar)
  └─ spawns → node tilt-launcher.mjs
                ├─ serves dist/ (Vite build of Svelte app)
                ├─ /api/config, /api/status, /api/start/:id, /api/stop/:id
                └─ spawns tilt (detached, survives restarts)
```

## Path resolution

The Swift app has **zero hardcoded paths**:

- **Node**: discovered by scanning nvm versions, homebrew, system PATH
- **Repo dir**: injected into Info.plist by `build.sh` at compile time, read via `Bundle.main`
- **Config**: always `~/.config/tilt-launcher/config.json`
- **Server script**: `<repoDir>/tilt-launcher.mjs`

## HTTP vs HTTPS

The server auto-detects: if `.certs/` contains `*-key.pem` and `*.pem` files, it uses HTTPS. Otherwise plain HTTP. No config change needed — just add/remove the `.certs/` directory.

## Design decisions

- **Tilt processes are detached** — survive server restarts, status from health checks
- **Config-driven** — all environments and services from config.json
- **No hardcoded paths** — everything discovered dynamically
- **HTTP by default, HTTPS optional** — reduces setup friction
- **Zero runtime npm deps** — server uses only Node built-ins
- **Svelte 5 runes** — `$state`, `$derived`, `$effect`, `$props`
- **TypeScript 7 native** — `tsgo` for type checking
- **ESLint 10 + Prettier** — `bun run build` chains check → lint → build

## Build commands

```bash
bun install              # install deps
bun run build            # tsgo + eslint + vite build
bun run dev              # vite HMR dev server
bun run check            # tsgo --noEmit
bun run lint             # eslint
bun run format           # prettier
./build.sh               # compile Swift app
./install.sh             # full install flow
```

## Coding conventions

- **Swift**: Single-file, AppKit, frame-based layout. `swiftc`, no SPM/Xcode. macOS 14+.
- **Svelte**: TypeScript `<script lang="ts">`, Svelte 5 runes, Tailwind utility classes.
- **Server**: ESM `.mjs`, no TypeScript, no npm deps. Reads config from env var or default path.
- **Config**: Svelte types in `src/lib/types.ts`, Swift structs are `Codable`, both match the JSON schema.
