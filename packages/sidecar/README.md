# @tilt-launcher/sidecar

Standalone sidecar process + typed client for the [Tilt Launcher SDK](../sdk). Communicates via JSON-RPC 2.0 over stdio — use it from any runtime or language.

## Install

```bash
bun add @tilt-launcher/sidecar
# or
npm install @tilt-launcher/sidecar
```

This installs both the **`tilt-sidecar` binary** and the **typed TypeScript client**. The SDK (`@tilt-launcher/sdk`) is included as a dependency — no need to install it separately.

## Quick Start

```ts
import { createSidecarClient } from '@tilt-launcher/sidecar';

const sidecar = createSidecarClient();
await sidecar.ready();

// Everything is typed — same API as the SDK
const config = await sidecar.getConfig();
const status = await sidecar.getStatus();

await sidecar.startEnv('my-app');

sidecar.onStatusUpdate((update) => {
  console.log('Status changed:', update);
});

sidecar.onLogDelta((delta) => {
  console.log('New logs:', delta);
});

// Clean up
sidecar.close();
```

## Why use the sidecar instead of the SDK directly?

|                   | SDK                                              | Sidecar                       |
| ----------------- | ------------------------------------------------ | ----------------------------- |
| **Use when**      | Your app is Bun/Node and you want direct control | You want a managed subprocess |
| **Process model** | In-process                                       | Separate binary               |
| **Language**      | TypeScript only                                  | Any (JSON-RPC over stdio)     |
| **Lifecycle**     | You manage polling and cleanup                   | Sidecar handles it            |
| **Best for**      | Libraries, tight integration                     | Apps, CLIs, multi-language    |

## API

### `createSidecarClient(options?)`

Spawns the sidecar and returns a typed client.

```ts
const sidecar = createSidecarClient({
  binPath: '/path/to/tilt-sidecar', // optional, auto-detected
  env: { TILT_LAUNCHER_CONFIG: '/custom/config.json' }, // optional
  readyTimeoutMs: 15000, // optional, default 10s
});
```

### Commands

| Method                         | Returns                                                |
| ------------------------------ | ------------------------------------------------------ |
| `ready()`                      | `Promise<void>` — resolves when sidecar is initialized |
| `getConfig()`                  | `Promise<Config>`                                      |
| `saveConfig(config)`           | `Promise<Result>`                                      |
| `getStatus()`                  | `Promise<StatusUpdate>`                                |
| `getLogs(envId)`               | `Promise<{ envLogs, resourceLogs }>`                   |
| `startEnv(envId)`              | `Promise<Result>`                                      |
| `stopEnv(envId)`               | `Promise<Result>`                                      |
| `restartEnv(envId)`            | `Promise<Result>`                                      |
| `triggerResource(envId, name)` | `Promise<Result>`                                      |
| `enableResource(envId, name)`  | `Promise<Result>`                                      |
| `disableResource(envId, name)` | `Promise<Result>`                                      |
| `discoverResources(input)`     | `Promise<DiscoverResult>`                              |
| `getHomeDir()`                 | `Promise<string>`                                      |
| `classifyTiltfilePath(path)`   | `Promise<PickedTiltfile>`                              |
| `readDir(dirPath)`             | `Promise<ReadDirResult>`                               |
| `close()`                      | Kills the sidecar process                              |

### Events

```ts
sidecar.onStatusUpdate((update: StatusUpdate) => { ... });
sidecar.onLogDelta((delta: LogDelta) => { ... });
sidecar.onConfigUpdated((config: Config) => { ... });
```

### Types

All types are re-exported from `@tilt-launcher/sdk`:

```ts
import type { Config, StatusUpdate, LogDelta, ResourceRow } from '@tilt-launcher/sidecar';
```

## Using the binary directly

The sidecar binary can be used from any language via JSON-RPC 2.0 over stdin/stdout:

```bash
# Spawn it
./node_modules/.bin/tilt-sidecar

# Send a request (newline-delimited JSON)
{"jsonrpc":"2.0","id":1,"method":"getStatus","params":{}}

# Receive a response
{"jsonrpc":"2.0","id":1,"result":{"envs":{}}}

# Receive push notifications (no id)
{"jsonrpc":"2.0","method":"statusUpdate","params":{...}}
```

## Requirements

- `tilt` must be on `$PATH`
- macOS or Linux (no Windows support yet)

## License

MIT
