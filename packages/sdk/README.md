# @tilt-launcher/sdk

SDK for managing [Tilt](https://tilt.dev) dev environments — start, stop, monitor, and control resources programmatically.

## Install

```bash
bun add @tilt-launcher/sdk
# or
npm install @tilt-launcher/sdk
```

## Quick Start

### One-Shot Query (CLI tools, CI, health checks)

```ts
import { queryTilt } from '@tilt-launcher/sdk';

const status = await queryTilt(10350);
if (!status.allHealthy) {
  for (const err of status.errors) {
    console.error(`${err.name}: ${err.lastBuildError ?? err.runtimeStatus}`);
  }
  process.exit(1);
}
console.log(`All ${status.healthy.length} resources healthy`);
```

### Streaming (dashboards, monitoring)

```ts
import { watchTilt } from '@tilt-launcher/sdk';

const stop = await watchTilt(10350, (event) => {
  for (const r of event.resources) {
    if (r.runtimeStatus === 'error') console.error(`${r.name} failed!`);
  }
  for (const log of event.logs) {
    console.log(`[${log.resourceName ?? 'system'}] ${log.text}`);
  }
});

// Stop watching when done
setTimeout(stop, 60_000);
```

### Full Client (multiple operations)

```ts
import { TiltClient } from '@tilt-launcher/sdk';

const tilt = new TiltClient(10350);

if (await tilt.isReachable()) {
  const resources = await tilt.getResources();
  const status = await tilt.getStatus();
  const myService = await tilt.getResource('my-service');
  await tilt.triggerResource('my-service');
}

tilt.close();
```

### Full Manager (multi-env orchestration)

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
  onStatusUpdate: (update: StatusUpdate) => console.log('Status:', update.envs),
  onLogDelta: (delta: LogDelta) => console.log('Logs:', delta),
});

sdk.startPolling(5000);
await sdk.startEnv('my-app');
```

## API

### `queryTilt(port, options?)` → `Promise<TiltStatus>`

One-shot: fetch all resources and return a structured status summary. No cleanup needed.

### `watchTilt(port, callback, options?)` → `Promise<() => void>`

Stream resource + log updates via WebSocket. Returns an unsubscribe function.

### `TiltClient`

| Method                  | Description                               |
| ----------------------- | ----------------------------------------- |
| `isReachable()`         | Check if Tilt is running at this port     |
| `getResources()`        | Fetch all resource statuses               |
| `getStatus()`           | Fetch resources as a `TiltStatus` summary |
| `getResource(name)`     | Get a single resource by name             |
| `triggerResource(name)` | Trigger a resource update                 |
| `watch(callback)`       | Subscribe to WebSocket updates            |
| `close()`               | Close all connections                     |

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

### Key Types

| Type             | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `TiltResource`   | Single resource from `TiltClient` (name, status, etc) |
| `TiltStatus`     | Status summary: resources, errors, healthy, pending   |
| `TiltWatchEvent` | WebSocket event: resources + logs                     |
| `ResourceRow`    | Resource from `TiltManagerSDK` (includes health)      |
| `StatusUpdate`   | Full status snapshot from `TiltManagerSDK`            |
| `LogDelta`       | Incremental log update                                |
| `Config`         | App configuration with environment list               |
| `Environment`    | Single Tilt environment definition                    |
| `LauncherBridge` | Abstract UI bridge interface                          |

## Requirements

- Node.js ≥ 18 or Bun
- `tilt` on `$PATH` (only required for `TiltManagerSDK`; `TiltClient` uses HTTP)

## License

MIT
