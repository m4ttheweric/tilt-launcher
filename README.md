# Tilt Launcher

A native macOS menu bar app and web dashboard for managing [Tilt](https://tilt.dev/) development environments.

- **Menu bar app** (▲) — quick links to Tilt dashboards, services, preferences, and Launch at Login
- **Web dashboard** — start/stop environments, live health checks, uptime tracking, log streaming
- **Configurable** — manage multiple Tilt environments across different repos via JSON config or the built-in preferences UI
- **Distributable** — installable via DMG or `./install.sh`, builds for both Apple Silicon and Intel

## Quick Start

### Option A: Download the DMG

Download the latest release from [GitHub Releases](../../releases), open the DMG, and drag **Tilt Launcher** to Applications.

### Option B: Build from source

```bash
git clone https://github.com/m4ttheweric/tilt-launcher.git
cd tilt-launcher
./install.sh
```

The installer will:

1. Check prerequisites (Node.js, Tilt, Swift compiler)
2. Install dependencies and build the dashboard (`bun install && bun run build`)
3. Compile and install the menu bar app to `/Applications/`
4. Create a config file at `~/.config/tilt-launcher/config.json`
5. Optionally set up HTTPS with a custom domain (e.g. `local.dev`)

## Prerequisites

- **macOS** 14+ (Sonoma or later)
- **Node.js** 22+ (`brew install node`)
- **Tilt** (`brew install tilt-dev/tap/tilt`)
- **bun** (optional, preferred — `brew install oven-sh/bun/bun`; falls back to npm)

## Configuration

Edit `~/.config/tilt-launcher/config.json`:

```json
{
  "port": 10400,
  "dashboardUrl": "http://localhost:10400",
  "environments": [
    {
      "id": "my-project",
      "name": "My Project",
      "repoDir": "/path/to/your/project",
      "tiltfile": "Tiltfile",
      "tiltPort": 10350,
      "description": "Local development environment",
      "services": [
        { "id": "api", "label": "API", "port": 4000, "path": "/" },
        { "id": "web", "label": "Web", "port": 3000, "path": "/" }
      ]
    }
  ]
}
```

Each environment has:

- **repoDir** — absolute path to the repo containing the Tiltfile
- **tiltfile** — Tiltfile name (relative to repoDir)
- **tiltPort** — port for the Tilt dashboard (each env needs a unique port)
- **services** — health check endpoints shown in the dashboard

You can also edit config from the menu bar via **Preferences...** (⌘,).

## How it Works

```
TiltLauncher.app (menu bar)
  └─ spawns → tilt-launcher.mjs (web server on :10400)
                ├─ GET  /           → Svelte dashboard
                ├─ GET  /api/config → config.json
                ├─ GET  /api/status → health + status
                ├─ POST /api/start/:id → tilt up (detached)
                └─ POST /api/stop/:id  → tilt down
```

Tilt processes are **detached** — they survive dashboard restarts. Status is derived from health checks, not process tracking, so the dashboard can restart without affecting running environments.

The `.app` is self-contained: server, dashboard, and config template are bundled in `Contents/Resources/`. Only Node.js needs to be installed on the system.

## Menu Bar Features

- **Open Dashboard** — opens the web UI in your browser
- **Tilt Dashboards** — per-environment links to Tilt UIs
- **Local Apps** — per-environment service links
- **Server status** — running/stopped indicator
- **Restart Server** — restart the Node server without affecting Tilt
- **Launch at Login** — toggle auto-start on login (uses SMAppService)
- **Preferences** — edit environments and services in a native macOS window

## HTTPS Setup (Optional)

By default the dashboard runs on plain HTTP at `http://localhost:10400`. The installer offers to set up HTTPS, or you can do it manually:

```bash
brew install mkcert && mkcert -install
mkdir -p .certs && cd .certs && mkcert local.dev && cd ..
echo '127.0.0.1	local.dev' | sudo tee -a /etc/hosts
echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 10400" | sudo pfctl -ef -
```

Update `dashboardUrl` in your config to `https://local.dev`. The server auto-detects certs in `.certs/` and switches to HTTPS.

## Development

Built with **Svelte 5** (runes), **Tailwind CSS v4**, **TypeScript 7** (native preview / tsgo), **Vite 7**, and **bun**.

```bash
bun install          # install deps (also installs pre-commit hook)
bun run dev          # vite dev server with HMR
bun run build        # type check → lint → production build
bun run check        # tsgo type check
bun run lint         # eslint (svelte + ts strict)
bun run lint:fix     # eslint with auto-fix
bun run format       # prettier (svelte + tailwind class sorting)
bun run format:check # prettier check (CI-friendly)
./build.sh           # compile Swift menu bar app + bundle resources
./package-dmg.sh     # create distributable DMG
```

After frontend changes: `bun run build`, then "Restart Server" from the menu bar.
After Swift changes: `./build.sh && cp -r TiltLauncher.app /Applications/`, then relaunch.

### Pre-commit Hook

Installed automatically via `bun install` (the `prepare` script). Runs 8 checks:

**Code Quality:** Prettier, TypeScript (tsgo), ESLint, Swift types, SwiftLint (optional), Node syntax
**Builds:** Vite build, Swift build

Both builds output to temp directories — no side effects on the running server. Uses `git stash --keep-index` to check exactly what's staged.

## File Structure

```
├── src/                         Svelte 5 + TypeScript dashboard
│   ├── App.svelte               Root component
│   ├── app.css                  Tailwind imports + custom theme
│   ├── main.ts                  Entry point
│   ├── vite-env.d.ts            Ambient type declarations
│   └── lib/
│       ├── api.ts               Typed API client
│       ├── types.ts             Config, Environment, StatusResponse
│       ├── utils.ts             formatUptime helper
│       └── components/
│           ├── HealthBar.svelte Health status chips
│           ├── EnvCard.svelte   Environment card with controls
│           └── LogPanel.svelte  Tabbed log viewer
├── tilt-launcher.mjs            Node.js server (HTTP/HTTPS, API, static)
├── TiltLauncher.swift           macOS menu bar app (AppKit + SMAppService)
├── config.example.json          Example config (copied on first install)
├── build.sh                     Swift compilation + resource bundling
├── install.sh                   One-step installer
├── package-dmg.sh               DMG packaging for distribution
├── hooks/pre-commit             Pre-commit hook (8 checks)
├── .github/workflows/release.yml  CI: build + DMG + GitHub Release
├── vite.config.js               Vite + Svelte + Tailwind
├── eslint.config.js             ESLint 10 flat config
├── tsconfig.json                TypeScript 7 native (tsgo)
├── .prettierrc                  Prettier + Svelte + Tailwind sorting
└── package.json                 Scripts + dependencies
```

## Releasing

Tag a version to trigger the GitHub Actions workflow:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This builds DMGs for both Apple Silicon and Intel and attaches them to a GitHub Release.

## Uninstall

```bash
rm -rf /Applications/TiltLauncher.app
rm -rf ~/.config/tilt-launcher
# If HTTPS was set up:
sudo sed -i '' '/YOUR_DOMAIN/d' /etc/hosts
```

## License

MIT
