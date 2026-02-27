# Tilt Launcher

Tilt Launcher is a single Electron app for managing [Tilt](https://tilt.dev/) development environments on macOS.

- Tray + desktop window in one runtime
- Start/stop environments, inspect resources, and stream logs
- Launch-at-login support from app settings
- Config stored at `~/.config/tilt-launcher/config.json`

## Prerequisites

- macOS 14+
- `bun`
- `tilt`

## Quick Start

```bash
git clone https://github.com/m4ttheweric/tilt-launcher.git
cd tilt-launcher
bun install
bun run dev
```

To install a packaged app locally:

```bash
bun run install:app
```

## Configuration

The app reads/writes:

- `~/.config/tilt-launcher/config.json`

If the file does not exist, `config.example.json` is used as the seed.

## Development Commands

```bash
bun run dev          # Electron + renderer dev mode
bun run build        # type check + lint + electron-vite build
bun run check        # tsgo --noEmit
bun run lint         # eslint
bun run lint:fix     # eslint --fix
bun run format       # prettier --write
bun run format:check # prettier --check
bun run package:app  # build macOS .app via electron-packager
bun run package:dmg -- "<app-bundle-path>" "<output-dmg-path>"
```

## Architecture

The Electron main process is the orchestrator:

- manages tray menu and dashboard window lifecycle
- runs Tilt start/stop/discovery
- polls resource status + health
- owns config persistence (explicit save only)

The renderer (`src/App.svelte`) provides dashboard and settings UI over IPC through `src/preload/index.ts`.

## Release Flow

Use:

```bash
bun run release
bun run release:dry
```

Tag pushes trigger GitHub Actions to package arm64 + x64 apps and publish DMGs.

## Uninstall

```bash
rm -rf /Applications/TiltLauncher.app
rm -rf ~/.config/tilt-launcher
```

## License

MIT
