import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';
import type {
  CachedResource,
  Config,
  DiscoverResult,
  Environment,
  LogDelta,
  ResourceRow,
  StatusResponse,
  StatusUpdate,
} from '../lib/types.ts';

type EnvState = 'running' | 'starting' | 'stopped';

interface TiltManagerSDKOptions {
  maxLogLines?: number;
  /** @deprecated Use onStatusUpdate + onLogDelta instead */
  onStatus?: (snapshot: StatusResponse) => void;
  /** Push status updates (resources / env state — no logs) */
  onStatusUpdate?: (update: StatusUpdate) => void;
  /** Push incremental log appends */
  onLogDelta?: (delta: LogDelta) => void;
  /** Called when the SDK mutates config in-memory (e.g. cachedResources for external envs). */
  onConfigMutated?: (config: Config) => void;
}

export class TiltManagerSDK {
  private config: Config;
  private readonly maxLogLines: number;
  private readonly onStatus: ((snapshot: StatusResponse) => void) | undefined;
  private readonly onStatusUpdate: ((update: StatusUpdate) => void) | undefined;
  private readonly onLogDelta: ((delta: LogDelta) => void) | undefined;
  private readonly onConfigMutated: ((config: Config) => void) | undefined;
  /** Tracks how many env log lines have been emitted per env */
  private readonly emittedEnvLogIndex = new Map<string, number>();
  /** Tracks how many resource log lines have been emitted per key */
  private readonly emittedResourceLogIndex = new Map<string, number>();

  private readonly processes = new Map<string, ChildProcess>();
  private readonly logs = new Map<string, string[]>();
  private readonly startTimes = new Map<string, number>();
  private readonly discoveredResources = new Map<string, CachedResource[]>();
  private readonly tiltPortReachable = new Map<string, boolean>();
  private readonly healthByKey = new Map<string, ResourceRow['health']>();
  private readonly newResourceCount = new Map<string, number>();
  private readonly resourceLogProcesses = new Map<string, ChildProcess>();
  private readonly resourceLogs = new Map<string, string[]>();
  private pollHandle: NodeJS.Timeout | null = null;
  // WebSocket streaming
  private readonly wsConnections = new Map<string, WebSocket>();
  private readonly wsReconnectTimers = new Map<string, NodeJS.Timeout>();
  private wsEnabled = false;

  constructor(config: Config, options?: TiltManagerSDKOptions) {
    this.config = config;
    this.maxLogLines = options?.maxLogLines ?? 800;
    this.onStatus = options?.onStatus;
    this.onStatusUpdate = options?.onStatusUpdate;
    this.onLogDelta = options?.onLogDelta;
    this.onConfigMutated = options?.onConfigMutated;
  }

  setConfig(next: Config): void {
    this.config = next;
  }

  /** Full snapshot including all logs — used for initial fetch or legacy compatibility */
  currentStatusSnapshot(): StatusResponse {
    const envs: StatusResponse['envs'] = {};
    for (const env of this.config.environments) {
      envs[env.id] = {
        status: this.getEnvState(env),
        logs: this.logs.get(env.id) ?? [],
        resourceLogs: this.getResourceLogsForEnv(env.id),
        tiltPort: env.tiltPort,
        uptime: this.startTimes.has(env.id) ? Date.now() - (this.startTimes.get(env.id) ?? Date.now()) : null,
        newResources: this.newResourceCount.get(env.id) ?? 0,
        resources: this.getDisplayRows(env),
      };
    }
    return { envs };
  }

  /** Log-free status snapshot for all environments */
  currentStatusUpdate(): StatusUpdate {
    const envs: StatusUpdate['envs'] = {};
    for (const env of this.config.environments) {
      envs[env.id] = {
        status: this.getEnvState(env),
        tiltPort: env.tiltPort,
        uptime: this.startTimes.has(env.id) ? Date.now() - (this.startTimes.get(env.id) ?? Date.now()) : null,
        newResources: this.newResourceCount.get(env.id) ?? 0,
        resources: this.getDisplayRows(env),
      };
    }
    return { envs };
  }

  /** Full log snapshot for a single environment */
  getEnvLogs(envId: string): { envLogs: string[]; resourceLogs: Record<string, string[]> } {
    return {
      envLogs: this.logs.get(envId) ?? [],
      resourceLogs: this.getResourceLogsForEnv(envId),
    };
  }

  startPolling(intervalMs = 5000): void {
    this.wsEnabled = true;
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.pollHandle = setInterval(() => {
      void this.pollTiltState();
    }, intervalMs);
    void this.pollTiltState();
  }

  stopPolling(): void {
    this.wsEnabled = false;
    if (!this.pollHandle) return;
    clearInterval(this.pollHandle);
    this.pollHandle = null;
    // Disconnect all WebSockets
    for (const envId of this.wsConnections.keys()) {
      this.disconnectWebSocket(envId);
    }
  }

  startEnv(envId: string): { ok: boolean; error?: string } {
    const env = this.envById(envId);
    if (!env) return { ok: false, error: 'Unknown environment.' };
    if (env.external) return { ok: false, error: 'Cannot start an external environment.' };
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

    const tracked = this.processes.get(env.id);
    if (tracked) {
      try {
        tracked.kill('SIGTERM');
      } catch {
        // already stopped
      }
    }
    const cwd = env.repoDir || homedir();
    void this.runCommand('tilt', ['down', '--port', String(env.tiltPort)], cwd);
    this.processes.delete(env.id);
    this.startTimes.delete(env.id);
    this.tiltPortReachable.delete(env.id);
    this.discoveredResources.delete(env.id);
    // Clear stale health entries for this env
    for (const key of this.healthByKey.keys()) {
      if (key.startsWith(`${env.id}:`)) this.healthByKey.delete(key);
    }
    this.disconnectWebSocket(env.id);
    this.stopResourceLogStreams(env.id);
    this.emitStatus();
    return { ok: true };
  }

  restartEnv(envId: string): { ok: boolean; error?: string } {
    const env = this.envById(envId);
    if (env?.external) return { ok: false, error: 'Cannot restart an external environment.' };
    const stopped = this.stopEnv(envId);
    if (!stopped.ok) return stopped;
    return this.startEnv(envId);
  }

  async triggerResource(envId: string, resourceName: string): Promise<{ ok: boolean; error?: string }> {
    return await this.runResourceCommand(envId, ['trigger', resourceName]);
  }

  async enableResource(envId: string, resourceName: string): Promise<{ ok: boolean; error?: string }> {
    return await this.runResourceCommand(envId, ['enable', resourceName]);
  }

  async disableResource(envId: string, resourceName: string): Promise<{ ok: boolean; error?: string }> {
    return await this.runResourceCommand(envId, ['disable', resourceName]);
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

    let discoveryProc: ChildProcess;
    try {
      discoveryProc = spawn('tilt', ['up', '-f', tiltfile, '--port', String(input.tiltPort)], {
        cwd: repoDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PWD: repoDir },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown process launch error';
      return {
        ok: false,
        resources: [],
        logs: logsOut,
        error: `Failed to start Tilt for discovery: ${message}`,
      };
    }
    let spawnError: Error | null = null;

    discoveryProc.stdout?.on('data', (chunk: Buffer) => {
      logsOut.push(...chunk.toString().split('\n').filter(Boolean));
    });
    discoveryProc.stderr?.on('data', (chunk: Buffer) => {
      logsOut.push(...chunk.toString().split('\n').filter(Boolean));
    });
    discoveryProc.once('error', (error: Error) => {
      spawnError = error;
      logsOut.push(`[launcher] ${error.message}`);
    });

    const startedAt = Date.now();
    let resources: CachedResource[] | null = null;
    while (Date.now() - startedAt < timeoutMs) {
      if (spawnError) break;
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

    if (spawnError) {
      return {
        ok: false,
        resources: [],
        logs: logsOut,
        error: `Failed to start Tilt for discovery: ${(spawnError as Error)?.message ?? 'Unknown error'}`,
      };
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
    // Legacy full-snapshot callback
    this.onStatus?.(this.currentStatusSnapshot());

    // New split callbacks
    if (this.onStatusUpdate) {
      this.onStatusUpdate(this.currentStatusUpdate());
    }
    if (this.onLogDelta) {
      const envLogs: LogDelta['envLogs'] = {};
      const resourceLogs: LogDelta['resourceLogs'] = {};
      let hasData = false;

      for (const env of this.config.environments) {
        const allEnvLines = this.logs.get(env.id) ?? [];
        const prevEnv = this.emittedEnvLogIndex.get(env.id) ?? 0;
        if (allEnvLines.length > prevEnv) {
          envLogs[env.id] = allEnvLines.slice(prevEnv);
          this.emittedEnvLogIndex.set(env.id, allEnvLines.length);
          hasData = true;
        }
      }

      for (const [key, lines] of this.resourceLogs) {
        const prev = this.emittedResourceLogIndex.get(key) ?? 0;
        if (lines.length > prev) {
          resourceLogs[key] = lines.slice(prev);
          this.emittedResourceLogIndex.set(key, lines.length);
          hasData = true;
        }
      }

      if (hasData) {
        this.onLogDelta({ envLogs, resourceLogs });
      }
    }
  }

  private appendLog(envId: string, line: string): void {
    const existing = this.logs.get(envId) ?? [];
    existing.push(line);
    this.logs.set(envId, existing.slice(-this.maxLogLines));
  }

  private getResourceLogsForEnv(envId: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const prefix = `${envId}:`;
    for (const [key, lines] of this.resourceLogs) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = lines;
      }
    }
    return result;
  }

  private startResourceLogStreams(env: Environment): void {
    const resources = this.discoveredResources.get(env.id) ?? [];
    for (const resource of resources) {
      const key = `${env.id}:${resource.name}`;
      if (this.resourceLogProcesses.has(key)) continue; // already streaming

      const child = spawn('tilt', ['logs', '-f', resource.name, '--port', String(env.tiltPort)], {
        cwd: env.repoDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PWD: env.repoDir },
      });

      const appendResourceLog = (line: string): void => {
        const existing = this.resourceLogs.get(key) ?? [];
        existing.push(line);
        if (existing.length > this.maxLogLines) {
          this.resourceLogs.set(key, existing.slice(-this.maxLogLines));
        } else {
          this.resourceLogs.set(key, existing);
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) appendResourceLog(line);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) appendResourceLog(line);
      });
      child.on('close', () => {
        this.resourceLogProcesses.delete(key);
      });
      child.on('error', () => {
        this.resourceLogProcesses.delete(key);
      });

      this.resourceLogProcesses.set(key, child);
    }
  }

  private stopResourceLogStreams(envId: string): void {
    const prefix = `${envId}:`;
    for (const [key, proc] of this.resourceLogProcesses) {
      if (key.startsWith(prefix)) {
        try {
          proc.kill('SIGTERM');
        } catch {
          /* already dead */
        }
        this.resourceLogProcesses.delete(key);
        this.resourceLogs.delete(key);
      }
    }
  }

  private envById(envId: string): Environment | undefined {
    return this.config.environments.find((env) => env.id === envId);
  }

  private getEnvState(env: Environment): EnvState {
    const resources = this.discoveredResources.get(env.id) ?? [];
    if (resources.some((resource) => resource.runtimeStatus === 'ok')) return 'running';
    if (this.tiltPortReachable.get(env.id)) return 'running';
    // External envs have no tracked process — status is purely port-based
    if (env.external) return 'stopped';
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

  private async runResourceCommand(envId: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
    const env = this.envById(envId);
    if (!env) return { ok: false, error: 'Unknown environment.' };
    const command = ['tilt', ...args, '--port', String(env.tiltPort)].join(' ');
    this.appendLog(env.id, `[launcher] ${command}`);
    const cwd = env.repoDir || homedir();
    const result = await this.runCommand('tilt', [...args, '--port', String(env.tiltPort)], cwd);
    if (result.code !== 0) {
      const detail = result.output.trim();
      if (detail) this.appendLog(env.id, detail);
      this.emitStatus();
      return { ok: false, error: detail || `Command failed: ${command}` };
    }
    const detail = result.output.trim();
    if (detail) this.appendLog(env.id, detail);
    await this.pollTiltState();
    return { ok: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseUIResource(item: any, env: Environment): CachedResource {
    const endpoint = this.absoluteEndpoint(item.status?.endpointLinks?.[0]?.url, env);
    const parsedEndpoint = this.parseEndpoint(endpoint);
    const labels = item.metadata?.labels ? Object.keys(item.metadata.labels) : [];
    const disableState = (item.status?.disableStatus?.state ?? '').toLowerCase();
    const isDisabled = disableState === 'disabled' || disableState === 'pending';
    const runtimeStatus = isDisabled ? 'disabled' : (item.status?.runtimeStatus ?? 'unknown');
    const resourceKind =
      runtimeStatus === 'not_applicable' || runtimeStatus === 'disabled'
        ? ('cmd' as const)
        : runtimeStatus === 'ok' || runtimeStatus === 'pending' || runtimeStatus === 'error'
          ? ('serve' as const)
          : ('unknown' as const);

    // Build history
    const buildHistory = item.status?.buildHistory as
      | Array<{
          startTime?: string;
          finishTime?: string;
          error?: string;
        }>
      | undefined;
    const lastBuild = buildHistory?.[0];
    const lastBuildDuration =
      lastBuild?.startTime && lastBuild?.finishTime
        ? (new Date(lastBuild.finishTime).getTime() - new Date(lastBuild.startTime).getTime()) / 1000
        : undefined;

    // Waiting state
    const waiting = item.status?.waiting as
      | {
          reason?: string;
          on?: Array<{ name?: string }>;
        }
      | undefined;

    // Conditions
    const rawConditions = item.status?.conditions as
      | Array<{
          type?: string;
          status?: string;
          lastTransitionTime?: string;
        }>
      | undefined;
    const conditions = rawConditions?.map((c) => ({
      type: c.type ?? '',
      status: c.status ?? '',
      ...(c.lastTransitionTime != null ? { lastTransitionTime: c.lastTransitionTime } : {}),
    }));

    // PID (comes as a string in WebSocket, number in CLI)
    const rawPid = item.status?.localResourceInfo?.pid;
    const pid = rawPid ? Number(rawPid) : undefined;

    return {
      name: item.metadata?.name ?? 'unknown',
      label: item.metadata?.name ?? 'unknown',
      category: labels[0] ?? 'services',
      type: item.status?.specs?.[0]?.type ?? 'unknown',
      endpoint,
      port: parsedEndpoint.port,
      path: parsedEndpoint.path,
      runtimeStatus,
      isDisabled,
      resourceKind,
      updateStatus: item.status?.updateStatus,
      waitingReason: waiting?.reason,
      waitingOn: waiting?.on?.map((ref: { name?: string }) => ref.name ?? '').filter(Boolean),
      lastDeployTime: item.status?.lastDeployTime,
      lastBuildDuration,
      lastBuildError: lastBuild?.error,
      hasPendingChanges: item.status?.hasPendingChanges,
      triggerMode: item.status?.triggerMode,
      queued: item.status?.queued,
      order: item.status?.order,
      pid,
      conditions,
    };
  }

  private async readTiltResources(env: Environment): Promise<CachedResource[] | null> {
    const result = await this.runCommand(
      'tilt',
      ['get', 'uiresources', '-o', 'json', '--port', String(env.tiltPort)],
      env.repoDir,
    );
    if (result.code !== 0) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(result.output) as { items?: any[] };
      return (parsed.items ?? [])
        .filter((item) => item.metadata?.name && item.metadata.name !== '(Tiltfile)')
        .map((item) => this.parseUIResource(item, env));
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

  private runtimeHealth(resource: CachedResource): ResourceRow['health'] {
    if (resource.isDisabled) return 'unknown';
    const runtime = (resource.runtimeStatus ?? '').toLowerCase();
    if (runtime === 'ok') return 'up';
    if (runtime === 'not_applicable' || runtime === '') return 'unknown';
    return 'down';
  }

  private async computeHealth(resource: CachedResource, env: Environment): Promise<ResourceRow['health']> {
    const runtimeDerived = this.runtimeHealth(resource);
    if (resource.isDisabled) return runtimeDerived;

    // Trust Tilt's runtime status — if Tilt says "ok", it's up.
    // Probes only supplement by upgrading 'unknown' to 'up', never downgrade.
    if (runtimeDerived === 'up' || runtimeDerived === 'down') return runtimeDerived;

    const parsed = this.parseEndpoint(resource.endpoint);
    const path = parsed.path ?? resource.path ?? '/';
    const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';

    // Tilt often exposes resource links through its own dashboard proxy port.
    // Probing that port only confirms Tilt is up, not the underlying service.
    if (parsed.hostname === 'localhost' && parsed.port === env.tiltPort) {
      return runtimeDerived;
    }

    if (parsed.hostname && parsed.port) {
      const direct = await this.tryConnect(parsed.hostname, parsed.port, path, protocol);
      if (direct) return 'up';
      if (parsed.hostname === 'localhost') {
        const loopback =
          (await this.tryConnect('127.0.0.1', parsed.port, path, protocol)) ||
          (await this.tryConnect('::1', parsed.port, path, protocol));
        if (loopback) return 'up';
      }
      return runtimeDerived;
    }

    if (!resource.port) return runtimeDerived;
    const ok =
      (await this.tryConnect('127.0.0.1', resource.port, path, protocol)) ||
      (await this.tryConnect('::1', resource.port, path, protocol));
    if (ok) return 'up';
    return runtimeDerived;
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
          isDisabled: false,
          health: 'missing',
          exists: false,
          error: `Resource '${name}' not found in Tiltfile output.`,
          resourceKind: 'unknown',
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
        isDisabled: found.isDisabled ?? false,
        health: this.healthByKey.get(key) ?? 'unknown',
        exists: true,
        resourceKind: found.resourceKind ?? 'unknown',
        updateStatus: found.updateStatus,
        waitingReason: found.waitingReason,
        waitingOn: found.waitingOn,
        lastDeployTime: found.lastDeployTime,
        lastBuildDuration: found.lastBuildDuration,
        lastBuildError: found.lastBuildError,
        hasPendingChanges: found.hasPendingChanges,
        triggerMode: found.triggerMode,
        queued: found.queued,
        order: found.order,
        pid: found.pid,
        conditions: found.conditions,
      };
    });
  }

  // ─── WebSocket streaming ──────────────────────────────────────────────────

  private async connectWebSocket(env: Environment): Promise<void> {
    if (this.wsConnections.has(env.id)) return; // already connected

    const tokenUrl = `http://127.0.0.1:${env.tiltPort}/api/websocket_token`;
    let token: string;
    try {
      const resp = await fetch(tokenUrl);
      if (!resp.ok) return;
      token = (await resp.text()).trim();
    } catch {
      return; // Tilt not ready yet
    }

    const wsUrl = `ws://127.0.0.1:${env.tiltPort}/ws/view?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      this.appendLog(env.id, '[launcher] WebSocket connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        this.handleWSMessage(env, data);
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onerror = () => {
      // Will trigger onclose
    };

    ws.onclose = () => {
      this.wsConnections.delete(env.id);
      // Auto-reconnect if still polling and env is active
      if (this.wsEnabled && this.processes.has(env.id)) {
        const timer = setTimeout(() => {
          this.wsReconnectTimers.delete(env.id);
          void this.connectWebSocket(env);
        }, 3000);
        this.wsReconnectTimers.set(env.id, timer);
      }
    };

    this.wsConnections.set(env.id, ws);
  }

  private disconnectWebSocket(envId: string): void {
    const timer = this.wsReconnectTimers.get(envId);
    if (timer) {
      clearTimeout(timer);
      this.wsReconnectTimers.delete(envId);
    }
    const ws = this.wsConnections.get(envId);
    if (ws) {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      this.wsConnections.delete(envId);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleWSMessage(env: Environment, data: any): void {
    // Parse uiResources from initial or delta messages
    if (data.uiResources && Array.isArray(data.uiResources)) {
      const incoming = (data.uiResources as Array<{ metadata?: { name?: string } }>)
        .filter((item) => item.metadata?.name && item.metadata.name !== '(Tiltfile)')
        .map((item) => this.parseUIResource(item, env));

      if (incoming.length > 0) {
        // Merge by name: update existing resources, add new ones, keep resources
        // not present in this delta (WS deltas may only contain changed resources)
        const existing = this.discoveredResources.get(env.id) ?? [];
        const byName = new Map<string, CachedResource>();
        for (const r of existing) byName.set(r.name, r);
        for (const r of incoming) byName.set(r.name, r);
        const merged = Array.from(byName.values());

        this.discoveredResources.set(env.id, merged);
        this.tiltPortReachable.set(env.id, true);

        const selected = new Set(env.selectedResources ?? []);
        // External envs auto-select all discovered resources (no manual discovery step)
        if (env.external) {
          env.selectedResources = merged.map((r) => r.name);
          this.newResourceCount.set(env.id, 0);
          this.onConfigMutated?.(this.config);
        } else {
          this.newResourceCount.set(env.id, merged.filter((r) => !selected.has(r.name)).length);
        }
        env.cachedResources = [...merged];

        // Derive health from runtimeStatus (no need for HTTP probes when using WS)
        for (const resource of incoming) {
          const key = `${env.id}:${resource.name}`;
          this.healthByKey.set(key, this.runtimeHealth(resource));
        }
      }
    }

    // Parse structured logs from logList
    if (data.logList?.segments && Array.isArray(data.logList.segments)) {
      const spans = data.logList.spans as Record<string, { manifestName?: string }> | undefined;
      for (const seg of data.logList.segments as Array<{ spanId?: string; text?: string }>) {
        const text = seg.text?.trimEnd();
        if (!text) continue;

        // Map spanId → resource name via spans map
        const manifestName = seg.spanId && spans?.[seg.spanId]?.manifestName;
        if (manifestName && manifestName !== '(Tiltfile)') {
          const key = `${env.id}:${manifestName}`;
          const existing = this.resourceLogs.get(key) ?? [];
          existing.push(text);
          if (existing.length > this.maxLogLines) {
            this.resourceLogs.set(key, existing.slice(-this.maxLogLines));
          } else {
            this.resourceLogs.set(key, existing);
          }
        }

        // Also append to env-level logs
        this.appendLog(env.id, text);
      }
    }

    this.emitStatus();
  }

  // ─── Polling (fallback) ──────────────────────────────────────────────────

  private async pollTiltState(): Promise<void> {
    for (const env of this.config.environments) {
      // If WebSocket is connected, skip CLI polling for this env
      const ws = this.wsConnections.get(env.id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Still probe health for services with endpoints (WS gives runtimeStatus-based health,
        // but endpoint probing validates actual reachability)
        const mergedByName = new Map<string, CachedResource>();
        for (const resource of this.discoveredResources.get(env.id) ?? []) mergedByName.set(resource.name, resource);
        for (const resourceName of env.selectedResources ?? []) {
          const resource = mergedByName.get(resourceName);
          if (!resource?.endpoint) continue;
          const key = `${env.id}:${resource.name}`;
          this.healthByKey.set(key, await this.computeHealth(resource, env));
        }
        continue;
      }

      // No WebSocket — fall back to CLI polling
      const tiltIsReachable =
        (await this.tryConnect('127.0.0.1', env.tiltPort, '/')) || (await this.tryConnect('::1', env.tiltPort, '/'));
      this.tiltPortReachable.set(env.id, tiltIsReachable);

      // Try to establish WebSocket when we first detect the port is reachable
      if (tiltIsReachable && !this.wsConnections.has(env.id) && this.wsEnabled) {
        void this.connectWebSocket(env);
      }

      const resources = await this.readTiltResources(env);
      if (resources) {
        this.discoveredResources.set(env.id, resources);
        const selected = new Set(env.selectedResources ?? []);
        // External envs auto-select all discovered resources (no manual discovery step)
        if (env.external) {
          env.selectedResources = resources.map((r) => r.name);
          this.newResourceCount.set(env.id, 0);
          this.onConfigMutated?.(this.config);
        } else {
          this.newResourceCount.set(env.id, resources.filter((resource) => !selected.has(resource.name)).length);
        }
        env.cachedResources = [...resources];

        // Start per-resource log streams for running envs (only if no WS)
        if (tiltIsReachable && !this.wsConnections.has(env.id)) {
          this.startResourceLogStreams(env);
        }
      }

      // Always probe selected services from merged cached/discovered data
      const mergedByName = new Map<string, CachedResource>();
      for (const resource of env.cachedResources ?? []) mergedByName.set(resource.name, resource);
      for (const resource of this.discoveredResources.get(env.id) ?? []) mergedByName.set(resource.name, resource);
      for (const resourceName of env.selectedResources ?? []) {
        const resource = mergedByName.get(resourceName);
        if (!resource) continue;
        const key = `${env.id}:${resource.name}`;
        this.healthByKey.set(key, await this.computeHealth(resource, env));
      }
    }
    this.emitStatus();
  }
}
