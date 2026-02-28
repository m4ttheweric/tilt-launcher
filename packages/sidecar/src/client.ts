/**
 * Typed JSON-RPC client for the Tilt Launcher sidecar.
 *
 * Usage:
 *   import { createSidecarClient } from '@tilt-launcher/sidecar/client';
 *
 *   const sidecar = createSidecarClient();
 *   await sidecar.ready();
 *
 *   const config = await sidecar.getConfig();
 *   const status = await sidecar.getStatus();
 *   sidecar.onStatusUpdate((update) => console.log(update));
 *
 *   sidecar.close();
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Config, DiscoverResult, LogDelta, PickedTiltfile, ReadDirResult, StatusUpdate } from '@tilt-launcher/sdk';

export type { Config, DiscoverResult, LogDelta, PickedTiltfile, ReadDirResult, StatusUpdate };

type Result = { ok: boolean; error?: string };

interface SidecarNotificationHandlers {
  onStatusUpdate?: (update: StatusUpdate) => void;
  onLogDelta?: (delta: LogDelta) => void;
  onConfigUpdated?: (config: Config) => void;
}

export interface SidecarClient {
  /** Wait for the sidecar to emit its `ready` notification. */
  ready(): Promise<void>;

  // ── Config ──
  getConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<Result>;

  // ── Status & Logs ──
  getStatus(): Promise<StatusUpdate>;
  getLogs(envId: string): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }>;

  // ── Lifecycle ──
  startEnv(envId: string): Promise<Result>;
  stopEnv(envId: string): Promise<Result>;
  restartEnv(envId: string): Promise<Result>;

  // ── Resource control ──
  triggerResource(envId: string, resourceName: string): Promise<Result>;
  enableResource(envId: string, resourceName: string): Promise<Result>;
  disableResource(envId: string, resourceName: string): Promise<Result>;

  // ── Discovery ──
  discoverResources(input: { tiltfilePath: string; tiltPort: number; timeoutMs?: number }): Promise<DiscoverResult>;

  // ── Filesystem ──
  getHomeDir(): Promise<string>;
  classifyTiltfilePath(filePath: string): Promise<PickedTiltfile>;
  readDir(dirPath: string): Promise<ReadDirResult>;

  // ── Events ──
  onStatusUpdate(listener: (update: StatusUpdate) => void): void;
  onLogDelta(listener: (delta: LogDelta) => void): void;
  onConfigUpdated(listener: (config: Config) => void): void;

  // ── Lifecycle ──
  close(): void;
}

export interface CreateSidecarOptions {
  /** Path to the tilt-sidecar binary. Auto-detected if not provided. */
  binPath?: string;
  /** Environment variables to pass to the sidecar process. */
  env?: Record<string, string>;
  /** Timeout for the ready() call in ms. Default: 10000 */
  readyTimeoutMs?: number;
}

function findSidecarBin(): string {
  // Check if installed as npm dependency (bin is linked)
  const candidates = [
    // Installed via npm — bin is in node_modules/.bin/
    join(process.cwd(), 'node_modules', '.bin', 'tilt-sidecar'),
    // Monorepo — workspace build
    join(process.cwd(), 'packages', 'sidecar', 'dist', 'tilt-sidecar'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Fallback: assume it's on PATH
  return 'tilt-sidecar';
}

export function createSidecarClient(options?: CreateSidecarOptions): SidecarClient {
  const bin = options?.binPath ?? findSidecarBin();
  const readyTimeoutMs = options?.readyTimeoutMs ?? 10_000;

  const proc: ChildProcess = spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options?.env },
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const handlers: SidecarNotificationHandlers = {};
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const readyTimer = setTimeout(() => {
    if (readyReject) {
      readyReject(new Error('Sidecar did not become ready within timeout'));
      readyReject = null;
    }
  }, readyTimeoutMs);

  // Read stdout
  let buffer = '';
  const stdout = proc.stdout;
  if (!stdout) throw new Error('Sidecar stdout not available');
  stdout.setEncoding('utf-8');
  stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if ('id' in msg) {
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
          const params = msg.params;
          switch (msg.method) {
            case 'ready':
              clearTimeout(readyTimer);
              if (readyResolve) {
                readyResolve();
                readyResolve = null;
              }
              break;
            case 'statusUpdate':
              handlers.onStatusUpdate?.(params as StatusUpdate);
              break;
            case 'logDelta':
              handlers.onLogDelta?.(params as LogDelta);
              break;
            case 'configUpdated':
              handlers.onConfigUpdated?.(params as Config);
              break;
          }
        }
      } catch {
        /* malformed */
      }
    }
  });

  function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
      const stdin = proc.stdin;
      if (!stdin) {
        pending.delete(id);
        reject(new Error('Sidecar stdin not available'));
        return;
      }
      stdin.write(line + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 60_000);
    });
  }

  return {
    ready: () => readyPromise,

    getConfig: () => rpc('getConfig'),
    saveConfig: (config) => rpc('saveConfig', { config }),

    getStatus: () => rpc('getStatus'),
    getLogs: (envId) => rpc('getLogs', { envId }),

    startEnv: (envId) => rpc('startEnv', { envId }),
    stopEnv: (envId) => rpc('stopEnv', { envId }),
    restartEnv: (envId) => rpc('restartEnv', { envId }),

    triggerResource: (envId, resourceName) => rpc('triggerResource', { envId, resourceName }),
    enableResource: (envId, resourceName) => rpc('enableResource', { envId, resourceName }),
    disableResource: (envId, resourceName) => rpc('disableResource', { envId, resourceName }),

    discoverResources: (input) => {
      const params: Record<string, unknown> = {
        tiltfilePath: input.tiltfilePath,
        tiltPort: input.tiltPort,
      };
      if (input.timeoutMs != null) params.timeoutMs = input.timeoutMs;
      return rpc('discoverResources', params);
    },

    getHomeDir: () => rpc('getHomeDir'),
    classifyTiltfilePath: (filePath) => rpc('classifyTiltfilePath', { filePath }),
    readDir: (dirPath) => rpc('readDir', { dirPath }),

    onStatusUpdate: (listener) => {
      handlers.onStatusUpdate = listener;
    },
    onLogDelta: (listener) => {
      handlers.onLogDelta = listener;
    },
    onConfigUpdated: (listener) => {
      handlers.onConfigUpdated = listener;
    },

    close: () => {
      clearTimeout(readyTimer);
      proc.stdin?.end();
      proc.kill('SIGTERM');
    },
  };
}
