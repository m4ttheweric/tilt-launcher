/**
 * E2E tests for TiltClient.
 *
 * These tests connect to a real running Tilt instance via HTTP/WebSocket.
 * Requires: `tilt` on $PATH, `python3` on $PATH.
 *
 * Run: bun test tests/tiltClient.e2e.test.ts --timeout 120000
 *
 * Ports used:
 *   19500 — Tilt dashboard for TiltClient tests
 *   18768 — Python HTTP server inside 'basic' fixture
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TiltClient, queryTilt } from '../packages/sdk/src/tiltClient.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const TILT_PORT = 19500;
const HTTP_PORT = 18768;
const FIXTURE_DIR = join(FIXTURES, 'basic');

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

// ─── TiltClient test suite ──────────────────────────────────────────────────

describe('TiltClient — basic fixture', () => {
  let tiltProcess: ChildProcess;

  beforeAll(async () => {
    await forceKillPort(TILT_PORT);
    await forceKillPort(HTTP_PORT);
    await sleep(1000);

    // Start Tilt directly (TiltClient doesn't manage processes)
    tiltProcess = spawn('tilt', ['up', '-f', 'Tiltfile', '--port', String(TILT_PORT)], {
      cwd: FIXTURE_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PWD: FIXTURE_DIR },
    });

    const dashReachable = await waitForPort(TILT_PORT, 60_000);
    expect(dashReachable).toBe(true);
    await sleep(8000); // wait for resources to be ready
  }, 90_000);

  afterAll(async () => {
    if (tiltProcess?.pid) {
      tiltProcess.kill('SIGTERM');
    }
    spawn('tilt', ['down', '--port', String(TILT_PORT)], {
      cwd: FIXTURE_DIR,
      stdio: 'ignore',
    });
    await sleep(2000);
    await forceKillPort(TILT_PORT);
    await forceKillPort(HTTP_PORT);
  }, 30_000);

  // ── isReachable ──

  it('isReachable returns true for running Tilt', async () => {
    const client = new TiltClient(TILT_PORT);
    const reachable = await client.isReachable();
    expect(reachable).toBe(true);
    client.close();
  });

  it('isReachable returns false for unused port', async () => {
    const client = new TiltClient(19999);
    const reachable = await client.isReachable();
    expect(reachable).toBe(false);
    client.close();
  });

  // ── getResources ──

  it('getResources returns an array of resources', async () => {
    const client = new TiltClient(TILT_PORT);
    const resources = await client.getResources();
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThan(0);
    client.close();
  });

  it('resources have expected fields', async () => {
    const client = new TiltClient(TILT_PORT);
    const resources = await client.getResources();
    const first = resources[0]!;
    expect(first.name).toBeDefined();
    expect(first.runtimeStatus).toBeDefined();
    expect(first.resourceKind).toBeDefined();
    expect(['serve', 'cmd', 'unknown']).toContain(first.resourceKind);
    client.close();
  });

  it('discovers hello-cmd and http-server', async () => {
    const client = new TiltClient(TILT_PORT);
    const resources = await client.getResources();
    const names = resources.map((r) => r.name);
    expect(names).toContain('hello-cmd');
    expect(names).toContain('http-server');
    client.close();
  });

  // ── getResource ──

  it('getResource returns a single resource by name', async () => {
    const client = new TiltClient(TILT_PORT);
    const resource = await client.getResource('hello-cmd');
    expect(resource).not.toBeNull();
    expect(resource!.name).toBe('hello-cmd');
    expect(resource!.resourceKind).toBe('cmd');
    client.close();
  });

  it('getResource returns null for unknown name', async () => {
    const client = new TiltClient(TILT_PORT);
    const resource = await client.getResource('nonexistent');
    expect(resource).toBeNull();
    client.close();
  });

  // ── getStatus ──

  it('getStatus returns structured status', async () => {
    const client = new TiltClient(TILT_PORT);
    const status = await client.getStatus();
    expect(status.resources.length).toBeGreaterThan(0);
    expect(Array.isArray(status.errors)).toBe(true);
    expect(Array.isArray(status.healthy)).toBe(true);
    expect(Array.isArray(status.pending)).toBe(true);
    expect(typeof status.allHealthy).toBe('boolean');
    client.close();
  });

  it('healthy resources have runtimeStatus ok', async () => {
    const client = new TiltClient(TILT_PORT);
    const status = await client.getStatus();
    for (const r of status.healthy) {
      expect(r.runtimeStatus).toBe('ok');
    }
    client.close();
  });

  // ── queryTilt convenience ──

  it('queryTilt returns status without manual cleanup', async () => {
    const status = await queryTilt(TILT_PORT);
    expect(status.resources.length).toBeGreaterThan(0);
    expect(status.resources.some((r) => r.name === 'http-server')).toBe(true);
  });

  // ── triggerResource ──

  it('triggerResource does not throw for a valid resource', async () => {
    const client = new TiltClient(TILT_PORT);
    await expect(client.triggerResource('hello-cmd')).resolves.toBeUndefined();
    client.close();
  });

  // ── watch (WebSocket) ──

  it('watch receives resource updates within timeout', async () => {
    const client = new TiltClient(TILT_PORT);
    let received = false;

    const stop = await client.watch((event) => {
      if (event.resources.length > 0) {
        received = true;
      }
    });

    // WebSocket initial message should arrive quickly
    await sleep(5000);
    stop();
    client.close();
    expect(received).toBe(true);
  }, 15_000);

  // ── error handling ──

  it('getResources throws on unreachable port', async () => {
    const client = new TiltClient(19999, { timeoutMs: 5000 });
    await expect(client.getResources()).rejects.toThrow();
    client.close();
  });

  // ── regression: data shape validation ──
  // These tests would have caught the HTTP/HTML bug — they validate
  // that actual TiltResource objects are returned, not garbage data.

  it('every resource has all required TiltResource fields with correct types', async () => {
    const client = new TiltClient(TILT_PORT);
    const resources = await client.getResources();
    for (const r of resources) {
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
      expect(typeof r.label).toBe('string');
      expect(typeof r.category).toBe('string');
      expect(typeof r.type).toBe('string');
      expect(typeof r.runtimeStatus).toBe('string');
      expect(typeof r.isDisabled).toBe('boolean');
      expect(['serve', 'cmd', 'unknown']).toContain(r.resourceKind);
    }
    client.close();
  });

  it('runtimeStatus values are valid Tilt statuses (not HTML/garbage)', async () => {
    const client = new TiltClient(TILT_PORT);
    const resources = await client.getResources();
    const validStatuses = ['ok', 'pending', 'error', 'not_applicable', 'disabled', 'unknown'];
    for (const r of resources) {
      expect(validStatuses).toContain(r.runtimeStatus);
    }
    client.close();
  });

  it('getStatus categories sum to total resources', async () => {
    const client = new TiltClient(TILT_PORT);
    const status = await client.getStatus();
    // Every resource should appear in exactly one category bucket
    const categorized = new Set([
      ...status.healthy.map((r) => r.name),
      ...status.errors.map((r) => r.name),
      ...status.pending.map((r) => r.name),
    ]);
    // Resources with not_applicable/disabled status won't be in any bucket
    const active = status.resources.filter(
      (r) => !r.isDisabled && r.runtimeStatus !== 'not_applicable' && r.runtimeStatus !== 'unknown',
    );
    expect(categorized.size).toBe(active.length);
    client.close();
  });
});
