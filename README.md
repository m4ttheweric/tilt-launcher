# Tilt Launcher

A native macOS menu bar app and web dashboard for managing [Tilt](https://tilt.dev/) development environments.

- **Menu bar app** (▲) — quick links to all your Tilt dashboards and services
- **Web dashboard** — start/stop environments, live health checks, uptime, log streaming
- **Configurable** — manage multiple Tilt environments across different repos via a JSON config or the built-in preferences UI

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/tilt-launcher.git
cd tilt-launcher
./install.sh
```

The installer will:

1. Check prerequisites (Node.js, Tilt, Swift)
2. Install dependencies and build the dashboard
3. Compile and install the menu bar app to `/Applications/`
4. Create a config file at `~/.config/tilt-launcher/config.json`
5. Optionally set up HTTPS with a custom domain (e.g. `local.dev`)

## Prerequisites

- **macOS** 14+ (Sonoma or later)
- **Node.js** 22+ (`brew install node`)
- **Tilt** (`brew install tilt-dev/tap/tilt`)
- **bun** (optional, preferred — `brew install oven-sh/bun/bun`)

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

You can also manage the config from the menu bar via **Preferences...** (⌘,).

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

## HTTPS Setup (Optional)

By default the dashboard runs on plain HTTP at `http://localhost:10400`. To use a custom domain with HTTPS:

```bash
# Install mkcert
brew install mkcert
mkcert -install

# Generate certs
mkdir -p .certs && cd .certs
mkcert local.dev
cd ..

# Add hosts entry
echo '127.0.0.1	local.dev' | sudo tee -a /etc/hosts

# Port forward 443 → 10400
echo "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 443 -> 127.0.0.1 port 10400" | sudo pfctl -ef -
```

Update `dashboardUrl` in your config to `https://local.dev`, then restart the server. The server auto-detects certs in `.certs/` and switches to HTTPS.

## Development

Built with **Svelte 5**, **Tailwind CSS v4**, **TypeScript 7** (native preview), **Vite 7**, and **bun**.

```bash
bun install          # install deps
bun run dev          # vite dev server with HMR
bun run build        # type check → lint → production build
bun run check        # tsgo type check
bun run lint         # eslint
bun run format       # prettier
./build.sh           # compile Swift menu bar app
```

After frontend changes: `bun run build`, then "Restart Server" from the menu bar.
After Swift changes: `./build.sh && cp -r TiltLauncher.app /Applications/`, then relaunch.

## File Structure

```
├── src/                      Svelte 5 + TypeScript dashboard
│   ├── App.svelte
│   ├── lib/
│   │   ├── api.ts            API client
│   │   ├── types.ts          TypeScript interfaces
│   │   ├── utils.ts          Helpers
│   │   └── components/       HealthBar, EnvCard, LogPanel
│   └── app.css               Tailwind + custom theme
├── tilt-launcher.mjs         Node.js server (HTTP/HTTPS, API, static files)
├── TiltLauncher.swift        macOS menu bar app (AppKit)
├── config.example.json       Example config (copied on first install)
├── build.sh                  Swift compilation script
├── install.sh                One-step installer
├── vite.config.js            Vite + Svelte + Tailwind
├── eslint.config.js          ESLint flat config
└── tsconfig.json             TypeScript 7 native (tsgo)
```

## Uninstall

```bash
rm -rf /Applications/TiltLauncher.app
rm -rf ~/.config/tilt-launcher
# If HTTPS was set up:
sudo sed -i '' '/YOUR_DOMAIN/d' /etc/hosts
```

## License

MIT
