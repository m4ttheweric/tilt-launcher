/**
 * E2E tests for TiltManagerSDK.
 *
 * These tests spawn real `tilt` processes against fixture Tiltfiles.
 * Requires: `tilt` on $PATH, `python3` on $PATH.
 *
 * Run: bun run test:sdk
 *
 * Ports used:
 *   19100 — Tilt dashboard for 'basic' fixture
 *   18765 — Python HTTP server inside 'basic' fixture
 *   19200 — Tilt dashboard for 'multi-resource' fixture
 *   18766 — Python HTTP server inside 'multi-resource' fixture
 *   19300 — Tilt dashboard for 'slow-build' fixture
 *   19400 — Tilt dashboard for 'dependencies' fixture
 *   18767 — Python HTTP server inside 'dependencies' fixture
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TiltManagerSDK } from '../packages/sdk/src/tiltManagerSDK.ts';
import type { Config } from '../packages/sdk/src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await sleep(1000);
  }
  return false;
}

async function waitForPortClosed(port: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await sleep(500);
  }
  return false;
}

async function forceKillPort(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(['lsof', '-ti', `:${port}`], { stdout: 'pipe', stderr: 'ignore' });
    const output = await new Response(proc.stdout).text();
    const pids = output.trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* lsof not available or no processes */
  }
}

// ─── Suite 1: Basic fixture ──────────────────────────────────────────────────
//
// Covers: startEnv, status transitions, resource discovery, kind
// classification, log capture, triggerResource, disableResource,
// enableResource, new UIResource fields, WebSocket connectivity.

describe('SDK — basic fixture', () => {
  const TILT_PORT = 19100;
  const ENV_ID = 'test-basic';
  const FIXTURE_DIR = join(FIXTURES, 'basic');

  const config: Config = {
    port: 10400,
    environments: [
      {
        id: ENV_ID,
        name: 'Test Basic',
        repoDir: FIXTURE_DIR,
        tiltfile: 'Tiltfile',
        tiltPort: TILT_PORT,
        selectedResources: ['hello-cmd', 'http-server'],
        cachedResources: [],
      },
    ],
  };

  let sdk: TiltManagerSDK;

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(18765);
    await sleep(1000);

    sdk = new TiltManagerSDK(config);

    const result = sdk.startEnv(ENV_ID);
    expect(result.ok).toBe(true);

    const dashReachable = await waitForPort(TILT_PORT, 60_000);
    expect(dashReachable).toBe(true);

    sdk.startPolling(3000);
    await sleep(10000); // wait for polling + WebSocket to connect + data to populate
  }, 90_000);

  afterAll(async () => {
    sdk.stopPolling();
    sdk.stopEnv(ENV_ID);
    await sleep(2000);
    await forceKillPort(TILT_PORT);
    await forceKillPort(18765);
    await waitForPortClosed(TILT_PORT, 10_000);
  }, 30_000);

  // ── Error handling ──

  it('returns ok: false and an error for an unknown env ID', () => {
    const result = sdk.startEnv('nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown environment/i);
  });

  it('returns ok: false when trying to start an already-active env', () => {
    const result = sdk.startEnv(ENV_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already active/i);
  });

  // ── Status snapshot ──

  it('snapshot has an entry for the env', () => {
    const snap = sdk.currentStatusSnapshot();
    expect(snap.envs[ENV_ID]).toBeDefined();
  });

  it('snapshot status is "running" or "starting"', () => {
    const snap = sdk.currentStatusSnapshot();
    expect(['running', 'starting']).toContain(snap.envs[ENV_ID]?.status);
  });

  // ── Resource discovery ──

  it('discovers all selectedResources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const names = resources.map((r) => r.name);
    expect(names).toContain('hello-cmd');
    expect(names).toContain('http-server');
  });

  it('classifies hello-cmd as resourceKind "cmd"', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    expect(cmd).toBeDefined();
    expect(cmd?.resourceKind).toBe('cmd');
  });

  it('classifies http-server as resourceKind "serve"', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve).toBeDefined();
    expect(serve?.resourceKind).toBe('serve');
  });

  it('assigns correct category from Tiltfile label for hello-cmd', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    expect(cmd?.category).toBe('on-demand');
  });

  it('assigns correct category from Tiltfile label for http-server', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve?.category).toBe('services');
  });

  // ── New UIResource fields ──

  it('updateStatus is populated for all resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.updateStatus).toBeDefined();
      expect(['ok', 'pending', 'building', 'error', 'not_applicable']).toContain(r.updateStatus!);
    }
  });

  it('lastDeployTime is a valid ISO date string for all resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.lastDeployTime).toBeDefined();
      expect(new Date(r.lastDeployTime!).getTime()).not.toBeNaN();
    }
  });

  it('lastBuildDuration is a number >= 0 for resources with build history', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    expect(cmd?.lastBuildDuration).toBeDefined();
    expect(cmd!.lastBuildDuration!).toBeGreaterThanOrEqual(0);
  });

  it('order is a number for all resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(typeof r.order).toBe('number');
    }
  });

  it('conditions array is populated for all resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.conditions).toBeDefined();
      expect(r.conditions!.length).toBeGreaterThan(0);
      expect(r.conditions![0]!.type).toBeDefined();
      expect(r.conditions![0]!.status).toBeDefined();
    }
  });

  it('pid is populated for http-server (serve resource)', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve?.pid).toBeDefined();
    expect(serve!.pid!).toBeGreaterThan(0);
  });

  it('triggerMode is undefined or 0 for auto-trigger resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    // triggerMode is 0 for auto-trigger; Tilt omits the field when it's the default value
    for (const r of resources) {
      expect(r.triggerMode === undefined || r.triggerMode === 0).toBe(true);
    }
  });

  // ── Health probing ──

  it('http-server health resolves to "up" once Python is ready (port 18765 reachable)', async () => {
    const httpUp = await waitForPort(18765, 30_000);
    expect(httpUp).toBe(true);

    await sleep(5000);

    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve?.health).toBe('up');
  }, 45_000);

  // ── Log capture ──

  it('captures launcher log lines', () => {
    const snap = sdk.currentStatusSnapshot();
    const logs = snap.envs[ENV_ID]?.logs ?? [];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('[launcher]'))).toBe(true);
  });

  it('log contains the tilt up command', () => {
    const snap = sdk.currentStatusSnapshot();
    const logs = snap.envs[ENV_ID]?.logs ?? [];
    expect(logs.some((l) => l.includes('tilt up'))).toBe(true);
  });

  it('resourceLogs has per-resource logs from WebSocket', () => {
    const snap = sdk.currentStatusSnapshot();
    const resourceLogs = snap.envs[ENV_ID]?.resourceLogs ?? {};
    // WebSocket should have populated logs for at least one resource
    const resourceNames = Object.keys(resourceLogs);
    expect(resourceNames.length).toBeGreaterThan(0);
  });

  // ── Resource control operations ──

  it('triggerResource returns ok: true for a cmd resource', async () => {
    const result = await sdk.triggerResource(ENV_ID, 'hello-cmd');
    expect(result.ok).toBe(true);
  }, 30_000);

  it('triggerResource returns ok: false for unknown resource gracefully', async () => {
    const result = await sdk.triggerResource(ENV_ID, 'nonexistent-resource');
    expect(result.ok).toBe(false);
  }, 15_000);

  it('disableResource → resource becomes disabled, enableResource → re-enabled', async () => {
    const disableResult = await sdk.disableResource(ENV_ID, 'http-server');
    expect(disableResult.ok).toBe(true);

    await sleep(5000);
    const snapAfterDisable = sdk.currentStatusSnapshot();
    const afterDisable = snapAfterDisable.envs[ENV_ID]?.resources?.find((r) => r.name === 'http-server');
    expect(afterDisable?.isDisabled).toBe(true);

    const enableResult = await sdk.enableResource(ENV_ID, 'http-server');
    expect(enableResult.ok).toBe(true);

    await sleep(5000);
    const snapAfterEnable = sdk.currentStatusSnapshot();
    const afterEnable = snapAfterEnable.envs[ENV_ID]?.resources?.find((r) => r.name === 'http-server');
    expect(afterEnable?.isDisabled).toBe(false);
  }, 45_000);
});

// ─── Suite 2: Multi-resource fixture ────────────────────────────────────────

describe('SDK — multi-resource fixture', () => {
  const TILT_PORT = 19200;
  const ENV_ID = 'test-multi';
  const FIXTURE_DIR = join(FIXTURES, 'multi-resource');

  const config: Config = {
    port: 10400,
    environments: [
      {
        id: ENV_ID,
        name: 'Test Multi',
        repoDir: FIXTURE_DIR,
        tiltfile: 'Tiltfile',
        tiltPort: TILT_PORT,
        selectedResources: ['batch-a', 'batch-b', 'setup-step', 'alt-server'],
        cachedResources: [],
      },
    ],
  };

  let sdk: TiltManagerSDK;

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(18766);
    await sleep(1000);

    sdk = new TiltManagerSDK(config);

    const result = sdk.startEnv(ENV_ID);
    expect(result.ok).toBe(true);

    const dashReachable = await waitForPort(TILT_PORT, 60_000);
    expect(dashReachable).toBe(true);

    sdk.startPolling(3000);
    await sleep(10000);
  }, 90_000);

  afterAll(async () => {
    sdk.stopPolling();
    sdk.stopEnv(ENV_ID);
    await sleep(2000);
    await forceKillPort(TILT_PORT);
    await forceKillPort(18766);
    await waitForPortClosed(TILT_PORT, 10_000);
  }, 30_000);

  // ── Discovery ──

  it('discovers all 4 expected resources', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const names = resources.map((r) => r.name);
    expect(names).toContain('batch-a');
    expect(names).toContain('batch-b');
    expect(names).toContain('setup-step');
    expect(names).toContain('alt-server');
  });

  it('batch-a and batch-b share the "batch" category', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const batchA = resources.find((r) => r.name === 'batch-a');
    const batchB = resources.find((r) => r.name === 'batch-b');
    expect(batchA?.category).toBe('batch');
    expect(batchB?.category).toBe('batch');
  });

  it('setup-step has "on-demand" category', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const setup = resources.find((r) => r.name === 'setup-step');
    expect(setup?.category).toBe('on-demand');
  });

  it('alt-server has "services" category and resourceKind "serve"', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const server = resources.find((r) => r.name === 'alt-server');
    expect(server?.category).toBe('services');
    expect(server?.resourceKind).toBe('serve');
  });

  it('all cmd resources have resourceKind "cmd"', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const name of ['batch-a', 'batch-b', 'setup-step']) {
      const resource = resources.find((r) => r.name === name);
      expect(resource?.resourceKind).toBe('cmd');
    }
  });

  it('all resources have updateStatus populated', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.updateStatus).toBeDefined();
    }
  });

  // ── Control ops ──

  it('can trigger each cmd resource independently', async () => {
    const results = await Promise.all([
      sdk.triggerResource(ENV_ID, 'batch-a'),
      sdk.triggerResource(ENV_ID, 'batch-b'),
      sdk.triggerResource(ENV_ID, 'setup-step'),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(true);
    }
  }, 45_000);

  // ── Stop ──

  it('stopEnv returns ok and internal state shows "stopped"', () => {
    sdk.stopPolling();
    const result = sdk.stopEnv(ENV_ID);
    expect(result.ok).toBe(true);

    const snap = sdk.currentStatusSnapshot();
    expect(snap.envs[ENV_ID]?.status).toBe('stopped');
  });

  // ── Restart ──

  it('can start from stopped state and then restartEnv succeeds', async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(18766);
    await sleep(2000);

    const startResult = sdk.startEnv(ENV_ID);
    expect(startResult.ok).toBe(true);

    const portUp = await waitForPort(TILT_PORT, 60_000);
    expect(portUp).toBe(true);

    const restartResult = sdk.restartEnv(ENV_ID);
    expect(restartResult.ok).toBe(true);

    await sleep(3000);
    const backUp = await waitForPort(TILT_PORT, 60_000);
    expect(backUp).toBe(true);
  }, 120_000);
});

// ─── Suite 3: Slow-build fixture ────────────────────────────────────────────
//
// Covers: lastBuildDuration > 0 for slow tasks, updateStatus values

describe('SDK — slow-build fixture', () => {
  const TILT_PORT = 19300;
  const ENV_ID = 'test-slow';
  const FIXTURE_DIR = join(FIXTURES, 'slow-build');

  const config: Config = {
    port: 10400,
    environments: [
      {
        id: ENV_ID,
        name: 'Test Slow',
        repoDir: FIXTURE_DIR,
        tiltfile: 'Tiltfile',
        tiltPort: TILT_PORT,
        selectedResources: ['slow-task', 'fast-task'],
        cachedResources: [],
      },
    ],
  };

  let sdk: TiltManagerSDK;

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await sleep(1000);

    sdk = new TiltManagerSDK(config);
    const result = sdk.startEnv(ENV_ID);
    expect(result.ok).toBe(true);

    const dashReachable = await waitForPort(TILT_PORT, 60_000);
    expect(dashReachable).toBe(true);

    sdk.startPolling(3000);
    await sleep(10000); // wait for slow-task to complete + polling to pick it up
  }, 90_000);

  afterAll(async () => {
    sdk.stopPolling();
    sdk.stopEnv(ENV_ID);
    await sleep(2000);
    await forceKillPort(TILT_PORT);
    await waitForPortClosed(TILT_PORT, 10_000);
  }, 30_000);

  it('discovers both slow-task and fast-task', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const names = resources.map((r) => r.name);
    expect(names).toContain('slow-task');
    expect(names).toContain('fast-task');
  });

  it('slow-task has lastBuildDuration >= 2 seconds', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const slow = resources.find((r) => r.name === 'slow-task');
    expect(slow?.lastBuildDuration).toBeDefined();
    expect(slow!.lastBuildDuration!).toBeGreaterThanOrEqual(1.5); // allow some tolerance
  });

  it('fast-task has lastBuildDuration < 1 second', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const fast = resources.find((r) => r.name === 'fast-task');
    expect(fast?.lastBuildDuration).toBeDefined();
    expect(fast!.lastBuildDuration!).toBeLessThan(1);
  });

  it('both tasks have updateStatus "ok" after completion', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const name of ['slow-task', 'fast-task']) {
      const r = resources.find((res) => res.name === name);
      expect(r?.updateStatus).toBe('ok');
    }
  });

  it('both tasks are cmd kind with "tasks" category', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    for (const name of ['slow-task', 'fast-task']) {
      const r = resources.find((res) => res.name === name);
      expect(r?.resourceKind).toBe('cmd');
      expect(r?.category).toBe('tasks');
    }
  });
});

// ─── Suite 4: Dependencies fixture ──────────────────────────────────────────
//
// Covers: resource_deps, order, dependency completion

describe('SDK — dependencies fixture', () => {
  const TILT_PORT = 19400;
  const ENV_ID = 'test-deps';
  const FIXTURE_DIR = join(FIXTURES, 'dependencies');

  const config: Config = {
    port: 10400,
    environments: [
      {
        id: ENV_ID,
        name: 'Test Deps',
        repoDir: FIXTURE_DIR,
        tiltfile: 'Tiltfile',
        tiltPort: TILT_PORT,
        selectedResources: ['setup', 'app'],
        cachedResources: [],
      },
    ],
  };

  let sdk: TiltManagerSDK;

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(18767);
    await sleep(1000);

    sdk = new TiltManagerSDK(config);
    const result = sdk.startEnv(ENV_ID);
    expect(result.ok).toBe(true);

    const dashReachable = await waitForPort(TILT_PORT, 60_000);
    expect(dashReachable).toBe(true);

    sdk.startPolling(3000);
    await sleep(12000); // wait for setup to complete + app to start
  }, 90_000);

  afterAll(async () => {
    sdk.stopPolling();
    sdk.stopEnv(ENV_ID);
    await sleep(2000);
    await forceKillPort(TILT_PORT);
    await forceKillPort(18767);
    await waitForPortClosed(TILT_PORT, 10_000);
  }, 30_000);

  it('discovers both setup and app', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const names = resources.map((r) => r.name);
    expect(names).toContain('setup');
    expect(names).toContain('app');
  });

  it('setup is a cmd resource with "infra" category', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const setup = resources.find((r) => r.name === 'setup');
    expect(setup?.resourceKind).toBe('cmd');
    expect(setup?.category).toBe('infra');
  });

  it('app is a serve resource with "services" category', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const app = resources.find((r) => r.name === 'app');
    expect(app?.resourceKind).toBe('serve');
    expect(app?.category).toBe('services');
  });

  it('order is assigned to both resources (setup before app)', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const setup = resources.find((r) => r.name === 'setup');
    const app = resources.find((r) => r.name === 'app');
    expect(setup?.order).toBeDefined();
    expect(app?.order).toBeDefined();
    // setup should have a lower order number than app (it's a dependency)
    expect(setup!.order!).toBeLessThan(app!.order!);
  });

  it('setup updateStatus is "ok" after completion', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const setup = resources.find((r) => r.name === 'setup');
    expect(setup?.updateStatus).toBe('ok');
  });

  it('app has a pid (running serve process)', async () => {
    // Wait for app server to start
    const appUp = await waitForPort(18767, 30_000);
    expect(appUp).toBe(true);
    await sleep(5000);

    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const app = resources.find((r) => r.name === 'app');
    expect(app?.pid).toBeDefined();
    expect(app!.pid!).toBeGreaterThan(0);
  }, 45_000);

  it('app has lastDeployTime after dependency resolution', () => {
    const snap = sdk.currentStatusSnapshot();
    const resources = snap.envs[ENV_ID]?.resources ?? [];
    const app = resources.find((r) => r.name === 'app');
    expect(app?.lastDeployTime).toBeDefined();
    expect(new Date(app!.lastDeployTime!).getTime()).not.toBeNaN();
  });
});
