/**
 * E2E tests for the Sidecar JSON-RPC server.
 *
 * These tests spawn the compiled sidecar binary and communicate via
 * stdin/stdout JSON-RPC 2.0. They use real `tilt` processes against
 * fixture Tiltfiles — same fixtures as the SDK tests.
 *
 * Requires: `tilt` on $PATH, `python3` on $PATH.
 *
 * Run: bun test tests/sidecar.e2e.test.ts
 *
 * Ports used:
 *   19500 — Tilt dashboard for sidecar 'basic' fixture
 *   18765 — Python HTTP server inside 'basic' fixture (hardcoded in Tiltfile)
 *   19600 — Tilt dashboard for sidecar 'discovery' tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Config, StatusUpdate, LogDelta, EnvStatusUpdate, ResourceRow } from '../packages/sdk/src/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const SIDECAR_BIN = join(__dirname, '..', 'packages', 'sidecar', 'dist', 'tilt-sidecar');

// Use an isolated config directory for tests
const TEST_CONFIG_DIR = join(__dirname, '.test-config');
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    /* lsof not available */
  }
}

// ── Sidecar Process Manager ─────────────────────────────────────────────────

interface SidecarProcess {
  proc: ChildProcess;
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  notifications: Array<{ method: string; params: unknown }>;
  waitForNotification: (method: string, timeoutMs?: number) => Promise<unknown>;
  close: () => void;
}

let nextId = 1;

function spawnSidecar(configPath?: string): Promise<SidecarProcess> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (configPath) env.TILT_LAUNCHER_CONFIG = configPath;

    const proc = spawn(SIDECAR_BIN, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    const pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const notifications: Array<{ method: string; params: unknown }> = [];
    const notificationWaiters: Array<{
      method: string;
      resolve: (params: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }> = [];
    let buffer = '';
    let ready = false;

    proc.stdout!.setEncoding('utf-8');
    proc.stdout!.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if ('id' in msg) {
            // Response
            const waiter = pending.get(msg.id);
            if (waiter) {
              pending.delete(msg.id);
              if (msg.error) {
                waiter.reject(new Error(msg.error.message));
              } else {
                waiter.resolve(msg.result);
              }
            }
          } else if ('method' in msg) {
            // Notification
            notifications.push({ method: msg.method, params: msg.params });

            // Check waiters
            for (let i = notificationWaiters.length - 1; i >= 0; i--) {
              if (notificationWaiters[i]!.method === msg.method) {
                clearTimeout(notificationWaiters[i]!.timer);
                notificationWaiters[i]!.resolve(msg.params);
                notificationWaiters.splice(i, 1);
              }
            }

            if (msg.method === 'ready' && !ready) {
              ready = true;
              resolve(sidecar);
            }
          }
        } catch {
          /* malformed line */
        }
      }
    });

    proc.on('error', reject);

    const timeout = setTimeout(() => {
      if (!ready) {
        proc.kill();
        reject(new Error('Sidecar did not emit ready notification within 10s'));
      }
    }, 10_000);

    function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
        proc.stdin!.write(line + '\n');

        // Timeout after 60s
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            rej(new Error(`RPC timeout: ${method} (id=${id})`));
          }
        }, 60_000);
      });
    }

    function waitForNotification(method: string, timeoutMs = 30_000): Promise<unknown> {
      // Check already-received notifications
      const existing = notifications.find((n) => n.method === method);
      if (existing) {
        notifications.splice(notifications.indexOf(existing), 1);
        return Promise.resolve(existing.params);
      }

      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`Notification timeout: ${method}`));
        }, timeoutMs);
        notificationWaiters.push({ method, resolve: res, timer });
      });
    }

    function close(): void {
      clearTimeout(timeout);
      proc.stdin!.end();
      proc.kill('SIGTERM');
    }

    const sidecar: SidecarProcess = { proc, send, notifications, waitForNotification, close };
  });
}

// ─── Suite 1: JSON-RPC Protocol ────────────────────────────────────────────

describe('Sidecar — JSON-RPC protocol', () => {
  let sidecar: SidecarProcess;

  beforeAll(async () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ environments: [] }));
    sidecar = await spawnSidecar(TEST_CONFIG_PATH);
  }, 15_000);

  afterAll(() => {
    sidecar.close();
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('returns a valid response for a known method', async () => {
    const result = await sidecar.send('getHomeDir');
    expect(typeof result).toBe('string');
    expect((result as string).length).toBeGreaterThan(0);
  });

  it('returns error for unknown method', async () => {
    await expect(sidecar.send('nonexistentMethod')).rejects.toThrow(/Method not found/);
  });

  it('handles concurrent requests with correct ID routing', async () => {
    const [home, config, status] = await Promise.all([
      sidecar.send('getHomeDir'),
      sidecar.send('getConfig'),
      sidecar.send('getStatus'),
    ]);
    expect(typeof home).toBe('string');
    expect(config).toHaveProperty('environments');
    expect(status).toHaveProperty('envs');
  });

  it('emitted ready notification on startup', () => {
    const ready = sidecar.notifications.find((n) => n.method === 'ready');
    expect(ready).toBeDefined();
    expect((ready!.params as Record<string, unknown>).version).toBe('1.2.0');
  });
});

// ─── Suite 2: Config Management ────────────────────────────────────────────

describe('Sidecar — config management', () => {
  let sidecar: SidecarProcess;
  const configDir = join(TEST_CONFIG_DIR, 'config-test');
  const configPath = join(configDir, 'config.json');

  beforeAll(async () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ environments: [] }));
    sidecar = await spawnSidecar(configPath);
  }, 15_000);

  afterAll(() => {
    sidecar.close();
    rmSync(configDir, { recursive: true, force: true });
  });

  it('getConfig returns initial empty config', async () => {
    const config = (await sidecar.send('getConfig')) as Config;
    expect(config.environments).toEqual([]);
    expect(config.themeMode).toBe('system');
  });

  it('saveConfig persists and returns updated config', async () => {
    const newConfig: Config = {
      themeMode: 'dark',
      environments: [
        {
          id: 'test-env',
          name: 'Test Environment',
          repoDir: '/tmp/test',
          tiltfile: 'Tiltfile',
          tiltPort: 19999,
          selectedResources: [],
          cachedResources: [],
        },
      ],
    };
    const result = (await sidecar.send('saveConfig', { config: newConfig })) as { ok: boolean };
    expect(result.ok).toBe(true);

    // Verify getConfig returns updated
    const config = (await sidecar.send('getConfig')) as Config;
    expect(config.themeMode).toBe('dark');
    expect(config.environments.length).toBe(1);
    expect(config.environments[0]!.name).toBe('Test Environment');
  });

  it('saveConfig emits configUpdated notification', async () => {
    // Clear any prior configUpdated notifications
    const priorIdx = sidecar.notifications.findIndex((n) => n.method === 'configUpdated');
    if (priorIdx !== -1) sidecar.notifications.splice(priorIdx, 1);

    const newConfig: Config = {
      themeMode: 'light',
      environments: [],
    };
    await sidecar.send('saveConfig', { config: newConfig });

    // Wait a tick for the notification to arrive
    await sleep(50);

    const notif = sidecar.notifications.find((n) => n.method === 'configUpdated');
    expect(notif).toBeDefined();
    expect((notif!.params as Config).themeMode).toBe('light');
  });

  it('saveConfig persists to disk', async () => {
    const saved = JSON.parse(readFileSync(configPath, 'utf-8')) as Config;
    expect(saved.themeMode).toBe('light');
  });

  it('saveConfig rejects duplicate tiltPort across environments', async () => {
    const badConfig: Config = {
      environments: [
        {
          id: 'env-a',
          name: 'Env A',
          repoDir: '/tmp/a',
          tiltfile: 'Tiltfile',
          tiltPort: 19000,
          selectedResources: [],
          cachedResources: [],
        },
        {
          id: 'env-b',
          name: 'Env B',
          repoDir: '/tmp/b',
          tiltfile: 'Tiltfile',
          tiltPort: 19000,
          selectedResources: [],
          cachedResources: [],
        },
      ],
    };
    const result = (await sidecar.send('saveConfig', { config: badConfig })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Port 19000/);
  });
});

// ─── Suite 3: Filesystem operations ────────────────────────────────────────

describe('Sidecar — filesystem', () => {
  let sidecar: SidecarProcess;

  beforeAll(async () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ environments: [] }));
    sidecar = await spawnSidecar(TEST_CONFIG_PATH);
  }, 15_000);

  afterAll(() => {
    sidecar.close();
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it('getHomeDir returns home directory', async () => {
    const result = await sidecar.send('getHomeDir');
    expect(result).toBe(homedir());
  });

  it('classifyTiltfilePath correctly identifies a real Tiltfile', async () => {
    const tiltfile = join(FIXTURES, 'basic', 'Tiltfile');
    const result = (await sidecar.send('classifyTiltfilePath', { filePath: tiltfile })) as {
      path: string;
      isSymlink: boolean;
    };
    expect(result.path).toBe(tiltfile);
    expect(result.isSymlink).toBe(false);
  });

  it('readDir lists directory contents', async () => {
    const result = (await sidecar.send('readDir', { dirPath: FIXTURES })) as {
      ok: boolean;
      entries: Array<{ name: string; isDirectory: boolean }>;
    };
    expect(result.ok).toBe(true);
    const names = result.entries.map((e) => e.name);
    expect(names).toContain('basic');
    expect(names).toContain('multi-resource');
  });

  it('readDir returns error for nonexistent path', async () => {
    const result = (await sidecar.send('readDir', { dirPath: '/nonexistent/path/xyz' })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('readDir filters out dotfiles', async () => {
    // The project root has .git, .gitignore, etc. — none should appear
    const projectRoot = join(FIXTURES, '..');
    const result = (await sidecar.send('readDir', { dirPath: projectRoot })) as {
      ok: boolean;
      entries: Array<{ name: string }>;
    };
    expect(result.ok).toBe(true);
    const dotfiles = result.entries.filter((e) => e.name.startsWith('.'));
    expect(dotfiles.length).toBe(0);
  });

  it('readDir sorts directories before files', async () => {
    const result = (await sidecar.send('readDir', { dirPath: FIXTURES })) as {
      ok: boolean;
      entries: Array<{ name: string; isDirectory: boolean }>;
    };
    expect(result.ok).toBe(true);
    // All directories should come before all files
    let seenFile = false;
    for (const entry of result.entries) {
      if (!entry.isDirectory) seenFile = true;
      if (entry.isDirectory && seenFile) {
        throw new Error(`Directory "${entry.name}" appeared after a file — sort is wrong`);
      }
    }
  });

  it('readDir handles tilde expansion', async () => {
    const result = (await sidecar.send('readDir', { dirPath: '~' })) as {
      ok: boolean;
      path: string;
      entries: Array<{ name: string }>;
    };
    expect(result.ok).toBe(true);
    expect(result.path).toBe(homedir());
    expect(result.entries.length).toBeGreaterThan(0);
  });
});

// ─── Suite 4: Full lifecycle — basic fixture ────────────────────────────────
//
// Covers: startEnv, statusUpdate notifications, getStatus, getLogs,
// logDelta notifications, triggerResource, disableResource, enableResource,
// stopEnv, restartEnv, and all ResourceRow fields.

describe('Sidecar — basic fixture lifecycle', () => {
  const TILT_PORT = 19500;
  const HTTP_PORT = 18765;
  const ENV_ID = 'test-basic-sc';
  const FIXTURE_DIR = join(FIXTURES, 'basic');

  let sidecar: SidecarProcess;
  const configDir = join(TEST_CONFIG_DIR, 'lifecycle-test');
  const configPath = join(configDir, 'config.json');

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(HTTP_PORT);
    await sleep(1000);

    mkdirSync(configDir, { recursive: true });

    // Write config with a basic fixture environment.
    // Override the python port so it doesn't conflict with other test suites.
    const config: Config = {
      environments: [
        {
          id: ENV_ID,
          name: 'Test Basic Sidecar',
          repoDir: FIXTURE_DIR,
          tiltfile: 'Tiltfile',
          tiltPort: TILT_PORT,
          selectedResources: ['hello-cmd', 'http-server'],
          cachedResources: [],
        },
      ],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sidecar = await spawnSidecar(configPath);

    // Start the environment
    const result = (await sidecar.send('startEnv', { envId: ENV_ID })) as { ok: boolean };
    expect(result.ok).toBe(true);

    // Wait for Tilt dashboard to come up
    const dashUp = await waitForPort(TILT_PORT, 90_000);
    expect(dashUp).toBe(true);

    // Allow time for polling + WebSocket to populate data
    await sleep(12000);
  }, 120_000);

  afterAll(async () => {
    // Stop env via sidecar
    try {
      await sidecar.send('stopEnv', { envId: ENV_ID });
    } catch {
      /* sidecar may already be down */
    }
    await sleep(2000);
    sidecar.close();
    await forceKillPort(TILT_PORT);
    await forceKillPort(HTTP_PORT);
    await waitForPortClosed(TILT_PORT, 10_000);
    rmSync(configDir, { recursive: true, force: true });
  }, 30_000);

  // ── Error handling ──

  it('startEnv returns error for unknown env', async () => {
    const result = (await sidecar.send('startEnv', { envId: 'bogus-env' })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown environment/i);
  });

  it('startEnv returns error for already-running env', async () => {
    const result = (await sidecar.send('startEnv', { envId: ENV_ID })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already active/i);
  });

  // ── Status ──

  it('getStatus returns env with running status', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    expect(status.envs[ENV_ID]).toBeDefined();
    expect(['running', 'starting']).toContain(status.envs[ENV_ID]!.status);
  });

  it('getStatus includes resources', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    expect(resources.length).toBeGreaterThan(0);
    const names = resources.map((r) => r.name);
    expect(names).toContain('hello-cmd');
    expect(names).toContain('http-server');
  });

  it('statusUpdate notification was emitted', () => {
    const updates = sidecar.notifications.filter((n) => n.method === 'statusUpdate');
    expect(updates.length).toBeGreaterThan(0);
    const latest = updates[updates.length - 1]!.params as StatusUpdate;
    expect(latest.envs[ENV_ID]).toBeDefined();
  });

  // ── Resource fields (coverage for all fields) ──

  it('resources have correct resourceKind', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    const serve = resources.find((r) => r.name === 'http-server');
    expect(cmd?.resourceKind).toBe('cmd');
    expect(serve?.resourceKind).toBe('serve');
  });

  it('resources have correct category from Tiltfile labels', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    const serve = resources.find((r) => r.name === 'http-server');
    expect(cmd?.category).toBe('on-demand');
    expect(serve?.category).toBe('services');
  });

  it('resources have label populated', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.label).toBeDefined();
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('resources have updateStatus populated', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.updateStatus).toBeDefined();
      expect(['ok', 'pending', 'building', 'error', 'not_applicable']).toContain(r.updateStatus!);
    }
  });

  it('resources have lastDeployTime as valid ISO date', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.lastDeployTime).toBeDefined();
      expect(new Date(r.lastDeployTime!).getTime()).not.toBeNaN();
    }
  });

  it('resources have lastBuildDuration >= 0', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    const cmd = resources.find((r) => r.name === 'hello-cmd');
    expect(cmd?.lastBuildDuration).toBeDefined();
    expect(cmd!.lastBuildDuration!).toBeGreaterThanOrEqual(0);
  });

  it('resources have order as number', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(typeof r.order).toBe('number');
    }
  });

  it('resources have conditions array', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.conditions).toBeDefined();
      expect(r.conditions!.length).toBeGreaterThan(0);
      expect(r.conditions![0]!.type).toBeDefined();
      expect(r.conditions![0]!.status).toBeDefined();
    }
  });

  it('serve resource has pid > 0', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve?.pid).toBeDefined();
    expect(serve!.pid!).toBeGreaterThan(0);
  });

  it('triggerMode is 0 or undefined for auto-trigger resources', async () => {
    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    for (const r of resources) {
      expect(r.triggerMode === undefined || r.triggerMode === 0).toBe(true);
    }
  });

  // ── Health probing ──

  it('http-server health is "up" once Python is ready', async () => {
    const httpUp = await waitForPort(HTTP_PORT, 30_000);
    expect(httpUp).toBe(true);
    await sleep(5000);

    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    const resources = status.envs[ENV_ID]?.resources ?? [];
    const serve = resources.find((r) => r.name === 'http-server');
    expect(serve?.health).toBe('up');
  }, 45_000);

  // ── Logs ──

  it('getLogs returns env log lines', async () => {
    const logs = (await sidecar.send('getLogs', { envId: ENV_ID })) as {
      envLogs: string[];
      resourceLogs: Record<string, string[]>;
    };
    expect(logs.envLogs.length).toBeGreaterThan(0);
    expect(logs.envLogs.some((l) => l.includes('[launcher]'))).toBe(true);
  });

  it('getLogs returns resource logs from WebSocket', async () => {
    const logs = (await sidecar.send('getLogs', { envId: ENV_ID })) as {
      envLogs: string[];
      resourceLogs: Record<string, string[]>;
    };
    const resourceNames = Object.keys(logs.resourceLogs);
    expect(resourceNames.length).toBeGreaterThan(0);
  });

  it('logDelta notification was emitted', () => {
    const deltas = sidecar.notifications.filter((n) => n.method === 'logDelta');
    expect(deltas.length).toBeGreaterThan(0);
    const delta = deltas[deltas.length - 1]!.params as LogDelta;
    // Should have at least one entry
    const hasEnvLogs = Object.keys(delta.envLogs).length > 0;
    const hasResourceLogs = Object.keys(delta.resourceLogs).length > 0;
    expect(hasEnvLogs || hasResourceLogs).toBe(true);
  });

  // ── Resource control ──

  it('triggerResource returns ok for cmd resource', async () => {
    const result = (await sidecar.send('triggerResource', {
      envId: ENV_ID,
      resourceName: 'hello-cmd',
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
  }, 30_000);

  it('triggerResource returns error for unknown resource', async () => {
    const result = (await sidecar.send('triggerResource', {
      envId: ENV_ID,
      resourceName: 'nonexistent',
    })) as { ok: boolean };
    expect(result.ok).toBe(false);
  }, 15_000);

  it('disableResource → enableResource cycle', async () => {
    const disableResult = (await sidecar.send('disableResource', {
      envId: ENV_ID,
      resourceName: 'http-server',
    })) as { ok: boolean };
    expect(disableResult.ok).toBe(true);

    await sleep(5000);
    let status = (await sidecar.send('getStatus')) as StatusUpdate;
    let serve = status.envs[ENV_ID]?.resources?.find((r) => r.name === 'http-server');
    expect(serve?.isDisabled).toBe(true);

    const enableResult = (await sidecar.send('enableResource', {
      envId: ENV_ID,
      resourceName: 'http-server',
    })) as { ok: boolean };
    expect(enableResult.ok).toBe(true);

    await sleep(5000);
    status = (await sidecar.send('getStatus')) as StatusUpdate;
    serve = status.envs[ENV_ID]?.resources?.find((r) => r.name === 'http-server');
    expect(serve?.isDisabled).toBe(false);
  }, 45_000);

  // ── Stop & Restart ──

  it('stopEnv returns ok and status becomes stopped', async () => {
    const result = (await sidecar.send('stopEnv', { envId: ENV_ID })) as { ok: boolean };
    expect(result.ok).toBe(true);

    const status = (await sidecar.send('getStatus')) as StatusUpdate;
    expect(status.envs[ENV_ID]?.status).toBe('stopped');
  });

  it('restartEnv from stopped state', async () => {
    // First re-start
    await forceKillPort(TILT_PORT);
    await forceKillPort(HTTP_PORT);
    await sleep(2000);

    const startResult = (await sidecar.send('startEnv', { envId: ENV_ID })) as { ok: boolean };
    expect(startResult.ok).toBe(true);

    const portUp = await waitForPort(TILT_PORT, 60_000);
    expect(portUp).toBe(true);

    const restartResult = (await sidecar.send('restartEnv', { envId: ENV_ID })) as { ok: boolean };
    expect(restartResult.ok).toBe(true);

    await sleep(3000);
    const backUp = await waitForPort(TILT_PORT, 60_000);
    expect(backUp).toBe(true);
  }, 120_000);
});

// ─── Suite 5: Discovery ────────────────────────────────────────────────────

describe('Sidecar — discovery', () => {
  const DISCOVERY_PORT = 19600;
  let sidecar: SidecarProcess;
  const configDir = join(TEST_CONFIG_DIR, 'discovery-test');
  const configPath = join(configDir, 'config.json');

  beforeAll(async () => {
    await forceKillPort(DISCOVERY_PORT);
    await sleep(1000);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ environments: [] }));
    sidecar = await spawnSidecar(configPath);
  }, 15_000);

  afterAll(async () => {
    sidecar.close();
    await forceKillPort(DISCOVERY_PORT);
    await waitForPortClosed(DISCOVERY_PORT, 10_000);
    rmSync(configDir, { recursive: true, force: true });
  }, 30_000);

  it('discovers resources from a valid Tiltfile', async () => {
    const result = (await sidecar.send('discoverResources', {
      tiltfilePath: join(FIXTURES, 'basic', 'Tiltfile'),
      tiltPort: DISCOVERY_PORT,
      timeoutMs: 60_000,
    })) as { ok: boolean; resources: Array<{ name: string }>; logs: string[] };

    expect(result.ok).toBe(true);
    expect(result.resources.length).toBeGreaterThan(0);
    const names = result.resources.map((r) => r.name);
    expect(names).toContain('hello-cmd');
    expect(names).toContain('http-server');
    expect(result.logs.length).toBeGreaterThan(0);
  }, 90_000);

  it('returns error for nonexistent Tiltfile', async () => {
    const result = (await sidecar.send('discoverResources', {
      tiltfilePath: '/nonexistent/Tiltfile',
      tiltPort: DISCOVERY_PORT + 1,
      timeoutMs: 10_000,
    })) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  }, 30_000);
});
