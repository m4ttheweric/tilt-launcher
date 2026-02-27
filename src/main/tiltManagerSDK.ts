import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { basename, dirname } from 'node:path';
import type { CachedResource, Config, DiscoverResult, Environment, ResourceRow, StatusResponse } from '../lib/types.ts';

type EnvState = 'running' | 'starting' | 'stopped';

interface TiltManagerSDKOptions {
  maxLogLines?: number;
  onStatus?: (snapshot: StatusResponse) => void;
}

export class TiltManagerSDK {
  private config: Config;
  private readonly maxLogLines: number;
  private readonly onStatus: ((snapshot: StatusResponse) => void) | undefined;

  private readonly processes = new Map<string, ChildProcess>();
  private readonly logs = new Map<string, string[]>();
  private readonly startTimes = new Map<string, number>();
  private readonly discoveredResources = new Map<string, CachedResource[]>();
  private readonly tiltPortReachable = new Map<string, boolean>();
  private readonly healthByKey = new Map<string, ResourceRow['health']>();
  private readonly newResourceCount = new Map<string, number>();
  private pollHandle: NodeJS.Timeout | null = null;

  constructor(config: Config, options?: TiltManagerSDKOptions) {
    this.config = config;
    this.maxLogLines = options?.maxLogLines ?? 800;
    this.onStatus = options?.onStatus;
  }

  setConfig(next: Config): void {
    this.config = next;
  }

  currentStatusSnapshot(): StatusResponse {
    const envs: StatusResponse['envs'] = {};
    for (const env of this.config.environments) {
      envs[env.id] = {
        status: this.getEnvState(env),
        logs: this.logs.get(env.id) ?? [],
        tiltPort: env.tiltPort,
        uptime: this.startTimes.has(env.id) ? Date.now() - (this.startTimes.get(env.id) ?? Date.now()) : null,
        newResources: this.newResourceCount.get(env.id) ?? 0,
        resources: this.getDisplayRows(env),
      };
    }
    return { envs };
  }

  startPolling(intervalMs = 5000): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = setInterval(() => {
      void this.pollTiltState();
    }, intervalMs);
    void this.pollTiltState();
  }

  stopPolling(): void {
    if (!this.pollHandle) return;
    clearInterval(this.pollHandle);
    this.pollHandle = null;
  }

  startEnv(envId: string): { ok: boolean; error?: string } {
    const env = this.envById(envId);
    if (!env) return { ok: false, error: 'Unknown environment.' };
    const state = this.getEnvState(env);
    if (state === 'running' || state === 'starting') return { ok: false, error: 'Environment already active.' };

    this.appendLog(env.id, `[launcher] Starting ${env.name}...`);
    this.appendLog(env.id, `[launcher] tilt up -f ${env.tiltfile} --port ${env.tiltPort}`);
    const child = spawn('tilt', ['up', '-f', env.tiltfile, '--port', String(env.tiltPort)], {
      cwd: env.repoDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PWD: env.repoDir },
    });
    child.unref();
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) this.appendLog(env.id, line);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) this.appendLog(env.id, line);
    });
    child.on('close', (code) => {
      this.appendLog(env.id, `[launcher] Process exited with code ${code ?? 0}`);
      this.processes.delete(env.id);
      this.emitStatus();
    });
    child.on('error', (error: Error) => {
      this.appendLog(env.id, `[launcher] ${error.message}`);
      this.processes.delete(env.id);
      this.emitStatus();
    });
    this.processes.set(env.id, child);
    this.startTimes.set(env.id, Date.now());
    this.emitStatus();
    return { ok: true };
  }

  stopEnv(envId: string): { ok: boolean; error?: string } {
    const env = this.envById(envId);
    if (!env) return { ok: false, error: 'Unknown environment.' };
    this.appendLog(env.id, `[launcher] Stopping ${env.name}...`);

    void this.runCommand('lsof', ['-ti', `tcp:${env.tiltPort}`], env.repoDir).then((result) => {
      if (!result.output.trim()) return;
      for (const line of result.output.trim().split('\n')) {
        const pid = Number(line.trim());
        if (Number.isFinite(pid)) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // already stopped
          }
        }
      }
    });

    const tracked = this.processes.get(env.id);
    if (tracked?.pid) {
      try {
        process.kill(-tracked.pid, 'SIGTERM');
      } catch {
        try {
          tracked.kill('SIGTERM');
        } catch {
          // noop
        }
      }
    }
    void this.runCommand('tilt', ['down', '--port', String(env.tiltPort)], env.repoDir);
    this.processes.delete(env.id);
    this.startTimes.delete(env.id);
    this.tiltPortReachable.delete(env.id);
    this.emitStatus();
    return { ok: true };
  }

  async discoverResources(input: {
    tiltfilePath: string;
    tiltPort: number;
    timeoutMs?: number;
  }): Promise<DiscoverResult> {
    const repoDir = dirname(input.tiltfilePath);
    const tiltfile = basename(input.tiltfilePath);
    const timeoutMs = input.timeoutMs ?? 30000;
    const logsOut: string[] = [];

    const discoveryProc = spawn('tilt', ['up', '-f', tiltfile, '--port', String(input.tiltPort)], {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PWD: repoDir },
    });

    discoveryProc.stdout.on('data', (chunk: Buffer) => {
      logsOut.push(...chunk.toString().split('\n').filter(Boolean));
    });
    discoveryProc.stderr.on('data', (chunk: Buffer) => {
      logsOut.push(...chunk.toString().split('\n').filter(Boolean));
    });

    const startedAt = Date.now();
    let resources: CachedResource[] | null = null;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const env: Environment = {
        id: 'discovery',
        name: 'Discovery',
        repoDir,
        tiltfile,
        tiltPort: input.tiltPort,
        selectedResources: [],
        cachedResources: [],
      };
      resources = await this.readTiltResources(env);
      if (resources && resources.length > 0) break;
    }

    void this.runCommand('tilt', ['down', '--port', String(input.tiltPort)], repoDir);
    if (discoveryProc.pid) {
      try {
        process.kill(-discoveryProc.pid, 'SIGTERM');
      } catch {
        discoveryProc.kill('SIGTERM');
      }
    }

    if (!resources || resources.length === 0) {
      return {
        ok: false,
        resources: [],
        logs: logsOut,
        error:
          'No resources found. The Tiltfile may have only defined the Tiltfile itself, or it failed to start within the discovery timeout.',
      };
    }

    return { ok: true, resources, logs: logsOut };
  }

  private emitStatus(): void {
    this.onStatus?.(this.currentStatusSnapshot());
  }

  private appendLog(envId: string, line: string): void {
    const existing = this.logs.get(envId) ?? [];
    existing.push(line);
    this.logs.set(envId, existing.slice(-this.maxLogLines));
  }

  private envById(envId: string): Environment | undefined {
    return this.config.environments.find((env) => env.id === envId);
  }

  private getEnvState(env: Environment): EnvState {
    const resources = this.discoveredResources.get(env.id) ?? [];
    if (resources.some((resource) => resource.runtimeStatus === 'ok')) return 'running';
    if (this.tiltPortReachable.get(env.id)) return 'running';
    const proc = this.processes.get(env.id);
    if (proc && proc.exitCode === null && !proc.killed) return 'starting';
    return 'stopped';
  }

  private parseEndpoint(endpoint?: string): { protocol?: string; hostname?: string; port?: number; path?: string } {
    if (!endpoint) return {};
    try {
      const url = new URL(endpoint);
      return {
        protocol: url.protocol,
        hostname: url.hostname,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        path: url.pathname || '/',
      };
    } catch {
      return {};
    }
  }

  private absoluteEndpoint(endpoint: string | undefined, env: Environment): string | undefined {
    if (!endpoint) return undefined;
    try {
      return new URL(endpoint).toString();
    } catch {
      try {
        return new URL(endpoint, `http://localhost:${env.tiltPort}`).toString();
      } catch {
        return undefined;
      }
    }
  }

  private categoryFor(resource: CachedResource): string {
    if (resource.category) return resource.category;
    if (resource.runtimeStatus === 'not_applicable') return 'on-demand';
    return 'services';
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
    return await new Promise((resolve) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, PWD: cwd } });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('close', (code) => resolve({ code: code ?? 1, output }));
      child.on('error', (err: Error) => resolve({ code: 1, output: `${output}\n${err.message}` }));
    });
  }

  private async readTiltResources(env: Environment): Promise<CachedResource[] | null> {
    const result = await this.runCommand(
      'tilt',
      ['get', 'uiresources', '-o', 'json', '--port', String(env.tiltPort)],
      env.repoDir,
    );
    if (result.code !== 0) return null;
    try {
      const parsed = JSON.parse(result.output) as {
        items?: Array<{
          metadata?: { name?: string; labels?: Record<string, string> };
          status?: {
            endpointLinks?: Array<{ url?: string }>;
            runtimeStatus?: string;
            specs?: Array<{ type?: string }>;
          };
        }>;
      };
      return (parsed.items ?? [])
        .filter((item) => item.metadata?.name && item.metadata.name !== '(Tiltfile)')
        .map((item) => {
          const endpoint = this.absoluteEndpoint(item.status?.endpointLinks?.[0]?.url, env);
          const parsedEndpoint = this.parseEndpoint(endpoint);
          const labels = item.metadata?.labels ? Object.keys(item.metadata.labels) : [];
          return {
            name: item.metadata?.name ?? 'unknown',
            label: item.metadata?.name ?? 'unknown',
            category: labels[0] ?? 'services',
            type: item.status?.specs?.[0]?.type ?? 'unknown',
            endpoint,
            port: parsedEndpoint.port,
            path: parsedEndpoint.path,
            runtimeStatus: item.status?.runtimeStatus ?? 'unknown',
          };
        });
    } catch {
      return null;
    }
  }

  private async tryConnect(
    hostname: string,
    port: number,
    path = '/',
    protocol: 'http:' | 'https:' = 'http:',
  ): Promise<boolean> {
    return await new Promise((resolve) => {
      const client = protocol === 'https:' ? https : http;
      const request = client.request(
        {
          hostname,
          port,
          path,
          method: 'GET',
          timeout: 1500,
        },
        (response) => {
          response.resume();
          resolve(true);
        },
      );
      request.on('error', () => resolve(false));
      request.on('timeout', () => {
        request.destroy();
        resolve(false);
      });
      request.end();
    });
  }

  private async computeHealth(resource: CachedResource): Promise<ResourceRow['health']> {
    const parsed = this.parseEndpoint(resource.endpoint);
    const path = parsed.path ?? resource.path ?? '/';
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';

    if (parsed.hostname && parsed.port) {
      const direct = await this.tryConnect(parsed.hostname, parsed.port, path, protocol);
      if (direct) return 'up';
      if (parsed.hostname === 'localhost') {
        const loopback =
          (await this.tryConnect('127.0.0.1', parsed.port, path, protocol)) ||
          (await this.tryConnect('::1', parsed.port, path, protocol));
        return loopback ? 'up' : 'down';
      }
      return 'down';
    }

    if (!resource.port) return 'unknown';
    const ok =
      (await this.tryConnect('127.0.0.1', resource.port, path, protocol)) ||
      (await this.tryConnect('::1', resource.port, path, protocol));
    return ok ? 'up' : 'down';
  }

  private getDisplayRows(env: Environment): ResourceRow[] {
    const selected = env.selectedResources ?? [];
    const discovered = this.discoveredResources.get(env.id) ?? [];
    const cached = env.cachedResources ?? [];
    const byName = new Map<string, CachedResource>();
    for (const resource of cached) byName.set(resource.name, resource);
    for (const resource of discovered) byName.set(resource.name, resource);

    return selected.map((name) => {
      const key = `${env.id}:${name}`;
      const found = byName.get(name);
      if (!found) {
        return {
          key,
          name,
          label: name,
          category: 'services',
          runtimeStatus: 'missing',
          health: 'missing',
          exists: false,
          error: `Resource '${name}' not found in Tiltfile output.`,
        };
      }
      return {
        key,
        name: found.name,
        label: found.label || found.name,
        category: this.categoryFor(found),
        endpoint: found.endpoint,
        port: found.port,
        path: found.path,
        runtimeStatus: found.runtimeStatus ?? 'unknown',
        health: this.healthByKey.get(key) ?? 'unknown',
        exists: true,
      };
    });
  }

  private async pollTiltState(): Promise<void> {
    for (const env of this.config.environments) {
      const tiltIsReachable =
        (await this.tryConnect('127.0.0.1', env.tiltPort, '/')) || (await this.tryConnect('::1', env.tiltPort, '/'));
      this.tiltPortReachable.set(env.id, tiltIsReachable);

      const resources = await this.readTiltResources(env);
      if (resources) {
        this.discoveredResources.set(env.id, resources);
        const selected = new Set(env.selectedResources ?? []);
        this.newResourceCount.set(env.id, resources.filter((resource) => !selected.has(resource.name)).length);
        env.cachedResources = [...resources];
      }

      // Always probe selected services from merged cached/discovered data, even
      // when fresh Tilt discovery fails. This matches legacy health behavior.
      const mergedByName = new Map<string, CachedResource>();
      for (const resource of env.cachedResources ?? []) mergedByName.set(resource.name, resource);
      for (const resource of this.discoveredResources.get(env.id) ?? []) mergedByName.set(resource.name, resource);
      for (const resourceName of env.selectedResources ?? []) {
        const resource = mergedByName.get(resourceName);
        if (!resource) continue;
        const key = `${env.id}:${resource.name}`;
        this.healthByKey.set(key, await this.computeHealth(resource));
      }
    }
    this.emitStatus();
  }
}
