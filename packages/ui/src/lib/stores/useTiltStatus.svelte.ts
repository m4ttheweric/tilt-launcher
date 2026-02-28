/**
 * useTiltStatus — singleton reactive store for Tilt environment status + logs.
 *
 * Components import `useTiltStatus()` and reference properties directly.
 * The store auto-subscribes to IPC pushes from the main process:
 *   - `onStatusUpdate` → updates resources / env state (no logs)
 *   - `onLogDelta`     → appends new log lines
 *
 * Usage:
 *   const tilt = useTiltStatus();
 *   // Reactive reads:
 *   tilt.envs['my-env']?.status       // 'running' | 'starting' | 'stopped'
 *   tilt.envs['my-env']?.resources    // ResourceRow[]
 *   tilt.envLogs['my-env']            // string[]
 *   tilt.resourceLogs['my-env:svc']   // string[]
 */
import { fetchStatus, onStatusUpdate, onLogDelta } from '$lib/api.ts';
import type { EnvStatusUpdate, LogDelta, StatusUpdate } from '$lib/types.ts';

const MAX_LOG_LINES = 2000;

// ── Singleton reactive state ──────────────────────────────────────
const envs: Record<string, EnvStatusUpdate> = $state({});
let envLogs: Record<string, string[]> = $state({});
let resourceLogs: Record<string, string[]> = $state({});
let initialized = false;

function applyStatusUpdate(update: StatusUpdate): void {
  // Merge env-by-env so we don't lose envs not in this update
  for (const [id, env] of Object.entries(update.envs)) {
    envs[id] = env;
  }
}

function applyLogDelta(delta: LogDelta): void {
  for (const [envId, lines] of Object.entries(delta.envLogs)) {
    const existing = envLogs[envId] ?? [];
    envLogs[envId] = [...existing, ...lines].slice(-MAX_LOG_LINES);
  }
  for (const [key, lines] of Object.entries(delta.resourceLogs)) {
    const existing = resourceLogs[key] ?? [];
    resourceLogs[key] = [...existing, ...lines].slice(-MAX_LOG_LINES);
  }
}

/** Reset all state (e.g. when config changes) */
function resetLogs(): void {
  envLogs = {};
  resourceLogs = {};
}

// ── Public API ────────────────────────────────────────────────────

export interface TiltStatusStore {
  /** Reactive env status map (envId → status + resources, no logs) */
  readonly envs: Record<string, EnvStatusUpdate>;
  /** Reactive env log lines (envId → string[]) */
  readonly envLogs: Record<string, string[]>;
  /** Reactive resource log lines ("envId:resourceName" → string[]) */
  readonly resourceLogs: Record<string, string[]>;
  /** Reset log buffers (useful after config changes) */
  resetLogs: () => void;
  /** Call in root component's onMount to start IPC subscriptions */
  subscribe: () => () => void;
}

/**
 * Returns the singleton reactive store.
 *
 * Call `tilt.subscribe()` inside `onMount` of the root component (App.svelte)
 * to start listening for IPC pushes. All other components just read properties.
 */
export function useTiltStatus(): TiltStatusStore {
  return {
    get envs() {
      return envs;
    },
    get envLogs() {
      return envLogs;
    },
    get resourceLogs() {
      return resourceLogs;
    },
    resetLogs,
    subscribe(): () => void {
      // Fetch initial status
      if (!initialized) {
        initialized = true;
        void fetchStatus().then((update) => applyStatusUpdate(update)).catch(() => {});
      }

      // Subscribe to push updates
      const unsubStatus = onStatusUpdate((update) => applyStatusUpdate(update));
      const unsubLogs = onLogDelta((delta) => applyLogDelta(delta));

      return () => {
        unsubStatus();
        unsubLogs();
      };
    },
  };
}
