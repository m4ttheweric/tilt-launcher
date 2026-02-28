# @tilt-launcher/sdk

SDK for managing [Tilt](https://tilt.dev) dev environments — start, stop, monitor, and control resources programmatically.

## Install

```bash
bun add @tilt-launcher/sdk
# or
npm install @tilt-launcher/sdk
```

## Quick Start

```ts
import { TiltManagerSDK } from '@tilt-launcher/sdk';
import type { Config, StatusUpdate, LogDelta } from '@tilt-launcher/sdk';

const config: Config = {
  environments: [
    {
      id: 'my-app',
      name: 'My App',
      repoDir: '/path/to/repo',
      tiltfile: 'Tiltfile',
      tiltPort: 10350,
      selectedResources: [],
      cachedResources: [],
    },
  ],
};

const sdk = new TiltManagerSDK(config, {
  onStatusUpdate: (update: StatusUpdate) => {
    console.log('Status:', update.envs);
  },
  onLogDelta: (delta: LogDelta) => {
    console.log('Logs:', delta);
  },
});

// Start polling the Tilt API
sdk.startPolling(5000);

// Start an environment
await sdk.startEnv('my-app');

// Get current status
const status = sdk.currentStatusUpdate();

// Control resources
await sdk.triggerResource('my-app', 'web-server');
await sdk.disableResource('my-app', 'slow-service');
await sdk.enableResource('my-app', 'slow-service');

// Stop
await sdk.stopEnv('my-app');
sdk.stopPolling();
```

## API

### `TiltManagerSDK`

| Method                         | Description                        |
| ------------------------------ | ---------------------------------- |
| `startEnv(envId)`              | Start a Tilt environment           |
| `stopEnv(envId)`               | Stop a running environment         |
| `restartEnv(envId)`            | Kill and restart an environment    |
| `triggerResource(envId, name)` | Manually trigger a resource update |
| `enableResource(envId, name)`  | Re-enable a disabled resource      |
| `disableResource(envId, name)` | Disable a resource                 |
| `getEnvLogs(envId)`            | Get env + resource log lines       |
| `currentStatusUpdate()`        | Get latest status snapshot         |
| `setConfig(config)`            | Update config at runtime           |
| `discoverResources(input)`     | Discover resources from a Tiltfile |
| `startPolling(intervalMs)`     | Start polling Tilt APIs            |
| `stopPolling()`                | Stop polling                       |

### Types

- `Config` — app configuration with environment list
- `Environment` — a single Tilt environment definition
- `StatusUpdate` — full status snapshot (all envs + resources)
- `ResourceRow` — individual resource status (health, pid, labels, etc.)
- `LogDelta` — incremental log update
- `DiscoverResult` — result of resource discovery
- `LauncherBridge` — abstract UI bridge interface

### Callbacks

| Callback          | Fires when                                               |
| ----------------- | -------------------------------------------------------- |
| `onStatusUpdate`  | Tilt API poll returns new data                           |
| `onLogDelta`      | New log lines arrive via WebSocket                       |
| `onConfigMutated` | SDK internally modifies config (e.g., caching resources) |

## Requirements

- `tilt` must be on `$PATH`
- Node.js ≥ 18 or Bun

## License

MIT
