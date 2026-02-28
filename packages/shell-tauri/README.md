# Tauri Shell — Future Implementation

This package will contain the Tauri (Rust) shell for Tilt Launcher.

## Architecture

The Tauri shell acts as a thin native wrapper:

- **Sidecar manager** — Spawns and supervises the Bun SDK as a compiled sidecar binary
- **Config persistence** — Loads, normalizes, and saves `config.json`
- **OS integration** — System tray, file dialogs, login item settings
- **IPC bridge** — Forwards `invoke()` calls to the sidecar via stdin/stdout NDJSON, emits events to the webview

## Bridge Implementation

The Tauri shell implements `LauncherBridge` (from `@tilt-launcher/sdk`) for the UI:

```typescript
// Tauri bridge (injected into UI via setBridge)
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { LauncherBridge } from '@tilt-launcher/sdk';

const bridge: LauncherBridge = {
  getConfig: () => invoke('get_config'),
  startEnv: (envId) => invoke('start_env', { envId }),
  onStatusUpdate: (listener) => {
    const unlisten = listen('status-update', (e) => listener(e.payload));
    return () => { unlisten.then(fn => fn()); };
  },
  // ... etc
};
```

## Prerequisites

- [Rust toolchain](https://rustup.rs/)
- [Tauri CLI](https://tauri.app/start/create-project/)

## Getting Started (future)

```bash
# From project root
bun run --filter @tilt-launcher/shell-tauri dev
```

## Key Files (to create)

```
packages/shell-tauri/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── sidecar.rs        # Bun sidecar spawner + NDJSON bridge
│       ├── commands.rs       # Tauri invoke commands
│       ├── config.rs         # Config load/save/normalize
│       └── tray.rs           # System tray integration
├── package.json
└── README.md                 # (this file)
```

## Reference

See the migration plan for full details on the sidecar protocol,
command surface, and architecture diagrams.
