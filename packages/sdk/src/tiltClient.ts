/**
 * Standalone Tilt API client.
 *
 * Connects directly to a running Tilt instance via its HTTP/WebSocket API.
 * No config file, no process management — just point at a port and query.
 *
 * @example
 * ```ts
 * import { TiltClient } from '@tilt-launcher/sdk';
 *
 * const tilt = new TiltClient(10350);
 * const resources = await tilt.getResources();
 * const failing = resources.filter(r => r.runtimeStatus === 'error');
 * tilt.close();
 * ```
 */

import type { CachedResource } from './types.ts';

// ── Types ────────────────────────────────────────────────────────────────

export interface TiltResource {
  /** Resource name as defined in Tiltfile */
  name: string;
  /** Display label */
  label: string;
  /** Tilt category grouping */
  category: string;
  /** Resource type from spec (e.g. "local", "docker_compose") */
  type: string;
  /** Public endpoint URL if exposed */
  endpoint?: string | undefined;
  /** Port number extracted from endpoint */
  port?: number | undefined;
  /** Kind of resource: long-running service, one-shot command, or unknown */
  resourceKind: 'serve' | 'cmd' | 'unknown';
  /** Tilt runtime status: ok, pending, error, not_applicable, disabled */
  runtimeStatus: string;
  /** Whether the resource is disabled */
  isDisabled: boolean;
  /** Update status: ok, pending, error, not_applicable */
  updateStatus?: string | undefined;
  /** If waiting, why */
  waitingReason?: string | undefined;
  /** Resources this one is waiting on */
  waitingOn?: string[] | undefined;
  /** ISO timestamp of last deploy */
  lastDeployTime?: string | undefined;
  /** Duration of last build in seconds */
  lastBuildDuration?: number | undefined;
  /** Error message from last build, if any */
  lastBuildError?: string | undefined;
  /** Whether there are pending file changes */
  hasPendingChanges?: boolean | undefined;
  /** Trigger mode (0 = auto, 1 = manual) */
  triggerMode?: number | undefined;
  /** Whether a trigger is queued */
  queued?: boolean | undefined;
  /** PID of local resource process */
  pid?: number | undefined;
  /** Tilt conditions array */
  conditions?: Array<{ type: string; status: string; lastTransitionTime?: string }> | undefined;
}

export interface TiltStatus {
  /** All resources discovered in this Tilt instance */
  resources: TiltResource[];
  /** Resources currently in error state */
  errors: TiltResource[];
  /** Resources currently running OK */
  healthy: TiltResource[];
  /** Resources pending/building */
  pending: TiltResource[];
  /** Whether all non-disabled resources are healthy */
  allHealthy: boolean;
}

export interface TiltWatchEvent {
  /** Updated resource statuses */
  resources: TiltResource[];
  /** Log lines from this update (spanId-tagged) */
  logs: Array<{ resourceName?: string | undefined; text: string }>;
}

export type TiltWatchCallback = (event: TiltWatchEvent) => void;

// ── Internal helpers ─────────────────────────────────────────────────────

function parseEndpoint(endpoint?: string): { port?: number; path?: string } {
  if (!endpoint) return {};
  try {
    const url = new URL(endpoint);
    return {
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      path: url.pathname || '/',
    };
  } catch {
    return {};
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUIResource(item: any, tiltPort: number): TiltResource {
  const endpointUrl = item.status?.endpointLinks?.[0]?.url as string | undefined;
  let endpoint: string | undefined;
  if (endpointUrl) {
    try {
      endpoint = new URL(endpointUrl).toString();
    } catch {
      try {
        endpoint = new URL(endpointUrl, `http://localhost:${tiltPort}`).toString();
      } catch {
        endpoint = undefined;
      }
    }
  }

  const parsed = parseEndpoint(endpoint);
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
    | Array<{ startTime?: string; finishTime?: string; error?: string }>
    | undefined;
  const lastBuild = buildHistory?.[0];
  const lastBuildDuration =
    lastBuild?.startTime && lastBuild?.finishTime
      ? (new Date(lastBuild.finishTime).getTime() - new Date(lastBuild.startTime).getTime()) / 1000
      : undefined;

  // Waiting
  const waiting = item.status?.waiting as { reason?: string; on?: Array<{ name?: string }> } | undefined;

  // Conditions
  const rawConditions = item.status?.conditions as
    | Array<{ type?: string; status?: string; lastTransitionTime?: string }>
    | undefined;
  const conditions = rawConditions?.map((c) => ({
    type: c.type ?? '',
    status: c.status ?? '',
    ...(c.lastTransitionTime != null ? { lastTransitionTime: c.lastTransitionTime } : {}),
  }));

  const rawPid = item.status?.localResourceInfo?.pid;

  return {
    name: item.metadata?.name ?? 'unknown',
    label: item.metadata?.name ?? 'unknown',
    category: labels[0] ?? 'services',
    type: item.status?.specs?.[0]?.type ?? 'unknown',
    endpoint,
    port: parsed.port,
    resourceKind,
    runtimeStatus,
    isDisabled,
    updateStatus: item.status?.updateStatus,
    waitingReason: waiting?.reason,
    waitingOn: waiting?.on?.map((ref: { name?: string }) => ref.name ?? '').filter(Boolean),
    lastDeployTime: item.status?.lastDeployTime,
    lastBuildDuration,
    lastBuildError: lastBuild?.error,
    hasPendingChanges: item.status?.hasPendingChanges,
    triggerMode: item.status?.triggerMode,
    queued: item.status?.queued,
    pid: rawPid ? Number(rawPid) : undefined,
    conditions,
  };
}

function buildStatus(resources: TiltResource[]): TiltStatus {
  const errors = resources.filter((r) => r.runtimeStatus === 'error');
  const healthy = resources.filter((r) => r.runtimeStatus === 'ok');
  const pending = resources.filter((r) => r.runtimeStatus === 'pending');
  const active = resources.filter((r) => !r.isDisabled && r.runtimeStatus !== 'not_applicable');
  return {
    resources,
    errors,
    healthy,
    pending,
    allHealthy: active.length > 0 && errors.length === 0 && pending.length === 0,
  };
}

// ── TiltClient ───────────────────────────────────────────────────────────

export interface TiltClientOptions {
  /** Hostname of the Tilt instance. Default: '127.0.0.1' */
  host?: string;
  /** Timeout for HTTP requests in ms. Default: 5000 */
  timeoutMs?: number;
}

export class TiltClient {
  private readonly baseUrl: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private ws: WebSocket | null = null;
  private watchCallback: TiltWatchCallback | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(port: number, options?: TiltClientOptions) {
    const host = options?.host ?? '127.0.0.1';
    this.port = port;
    this.baseUrl = `http://${host}:${port}`;
    this.timeoutMs = options?.timeoutMs ?? 5000;
  }

  /** Check if Tilt is reachable at this port. */
  async isReachable(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/websocket_token`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /** Fetch all resources from this Tilt instance via `tilt get`. */
  async getResources(): Promise<TiltResource[]> {
    const result = await this.runTiltCli(['get', 'uiresources', '-o', 'json']);
    if (result.code !== 0) {
      throw new Error(`tilt get uiresources failed (exit ${result.code}): ${result.output.trim()}`);
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = JSON.parse(result.output) as { items?: any[] };
      return (data.items ?? [])
        .filter((item: { metadata?: { name?: string } }) => item.metadata?.name && item.metadata.name !== '(Tiltfile)')
        .map((item: unknown) => parseUIResource(item, this.port));
    } catch {
      throw new Error(`Failed to parse tilt output as JSON: ${result.output.slice(0, 200)}`);
    }
  }

  /** Fetch resources and return a structured status summary. */
  async getStatus(): Promise<TiltStatus> {
    const resources = await this.getResources();
    return buildStatus(resources);
  }

  /** Get a single resource by name. */
  async getResource(name: string): Promise<TiltResource | null> {
    const resources = await this.getResources();
    return resources.find((r) => r.name === name) ?? null;
  }

  /** Trigger a resource update (equivalent to pressing the trigger button in Tilt UI). */
  async triggerResource(name: string): Promise<void> {
    const result = await this.runTiltCli(['trigger', name]);
    if (result.code !== 0) {
      throw new Error(`tilt trigger failed (exit ${result.code}): ${result.output.trim()}`);
    }
  }

  /**
   * Watch for resource updates via WebSocket.
   * Returns an unsubscribe function.
   *
   * @example
   * ```ts
   * const stop = await tilt.watch((event) => {
   *   for (const r of event.resources) {
   *     if (r.runtimeStatus === 'error') console.error(`${r.name} failed!`);
   *   }
   * });
   * // Later:
   * stop();
   * ```
   */
  async watch(callback: TiltWatchCallback): Promise<() => void> {
    this.watchCallback = callback;
    await this.connectWS();
    return () => {
      this.watchCallback = null;
      this.disconnectWS();
    };
  }

  /** Close all connections. */
  close(): void {
    this.closed = true;
    this.watchCallback = null;
    this.disconnectWS();
  }
  // ── CLI helper ───────────────────────────────────────────────────────

  private async runTiltCli(args: string[]): Promise<{ code: number; output: string }> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve) => {
      const child = spawn('tilt', [...args, '--port', String(this.port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ code: 1, output: `${output}\ntilt command timed out after ${this.timeoutMs}ms` });
      }, this.timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, output });
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({ code: 1, output: `${output}\n${err.message}` });
      });
    });
  }

  // ── WebSocket internals ──────────────────────────────────────────────

  private async connectWS(): Promise<void> {
    if (this.ws) return;

    const tokenResp = await fetch(`${this.baseUrl}/api/websocket_token`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!tokenResp.ok) throw new Error('Could not get WebSocket token from Tilt');
    const token = (await tokenResp.text()).trim();

    const wsUrl = `ws://127.0.0.1:${this.port}/ws/view?token=${token}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        this.handleWSMessage(data);
      } catch {
        /* ignore malformed */
      }
    };

    ws.onerror = () => {
      /* triggers onclose */
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.watchCallback && !this.closed) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          void this.connectWS();
        }, 3000);
      }
    };

    this.ws = ws;
  }

  private disconnectWS(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleWSMessage(data: any): void {
    if (!this.watchCallback) return;

    const resources: TiltResource[] = [];
    const logs: Array<{ resourceName?: string | undefined; text: string }> = [];

    // Parse resources
    if (data.uiResources && Array.isArray(data.uiResources)) {
      for (const item of data.uiResources) {
        if (item.metadata?.name && item.metadata.name !== '(Tiltfile)') {
          resources.push(parseUIResource(item, this.port));
        }
      }
    }

    // Parse logs
    if (data.logList?.segments && Array.isArray(data.logList.segments)) {
      const spans = data.logList.spans as Record<string, { manifestName?: string }> | undefined;
      for (const seg of data.logList.segments as Array<{ spanId?: string; text?: string }>) {
        const text = seg.text?.trimEnd();
        if (!text) continue;
        const resourceName = seg.spanId && spans?.[seg.spanId]?.manifestName;
        logs.push({
          resourceName: resourceName && resourceName !== '(Tiltfile)' ? resourceName : undefined,
          text,
        });
      }
    }

    if (resources.length > 0 || logs.length > 0) {
      this.watchCallback({ resources, logs });
    }
  }
}

// ── Convenience functions ────────────────────────────────────────────────

/**
 * One-shot query: get the current status of all resources from a Tilt instance.
 *
 * @example
 * ```ts
 * import { queryTilt } from '@tilt-launcher/sdk';
 *
 * const status = await queryTilt(10350);
 * if (!status.allHealthy) {
 *   for (const err of status.errors) {
 *     console.error(`${err.name}: ${err.lastBuildError ?? err.runtimeStatus}`);
 *   }
 *   process.exit(1);
 * }
 * ```
 */
export async function queryTilt(port: number, options?: TiltClientOptions): Promise<TiltStatus> {
  const client = new TiltClient(port, options);
  try {
    return await client.getStatus();
  } finally {
    client.close();
  }
}

/**
 * Stream resource updates from a Tilt instance.
 * Returns an unsubscribe function.
 *
 * @example
 * ```ts
 * import { watchTilt } from '@tilt-launcher/sdk';
 *
 * const stop = await watchTilt(10350, (event) => {
 *   console.log(`${event.resources.length} resources updated`);
 * });
 *
 * // Stop watching after 30s
 * setTimeout(stop, 30_000);
 * ```
 */
export async function watchTilt(
  port: number,
  callback: TiltWatchCallback,
  options?: TiltClientOptions,
): Promise<() => void> {
  const client = new TiltClient(port, options);
  const unsub = await client.watch(callback);
  return () => {
    unsub();
    client.close();
  };
}

// ── Adapter: TiltResource → CachedResource (for TiltManagerSDK compat) ──

/** @internal Convert TiltResource to CachedResource for backward compatibility */
export function tiltResourceToCached(r: TiltResource): CachedResource {
  return {
    name: r.name,
    label: r.label,
    category: r.category,
    type: r.type,
    endpoint: r.endpoint,
    port: r.port,
    runtimeStatus: r.runtimeStatus,
    isDisabled: r.isDisabled,
    resourceKind: r.resourceKind,
    updateStatus: r.updateStatus,
    waitingReason: r.waitingReason,
    waitingOn: r.waitingOn,
    lastDeployTime: r.lastDeployTime,
    lastBuildDuration: r.lastBuildDuration,
    lastBuildError: r.lastBuildError,
    hasPendingChanges: r.hasPendingChanges,
    triggerMode: r.triggerMode,
    queued: r.queued,
    pid: r.pid,
    conditions: r.conditions,
  };
}
