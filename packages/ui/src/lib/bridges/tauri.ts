/**
 * Tauri bridge implementation of LauncherBridge.
 *
 * Uses @tauri-apps/api/core invoke() for request/response commands and
 * @tauri-apps/api/event listen() for streaming events.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-opener';
import { save } from '@tauri-apps/plugin-dialog';
import type { LauncherBridge } from '@tilt-launcher/sdk';
import type {
  Config,
  DiscoverResult,
  LoginItemSettings,
  LogDelta,
  PickedTiltfile,
  ReadDirResult,
  StatusUpdate,
} from '@tilt-launcher/sdk';

type Result = { ok: boolean; error?: string };

export const tauriBridge: LauncherBridge = {
  // ── Config ──────────────────────────────────────────────────────────
  getConfig: () => invoke<Config>('get_config'),
  saveConfig: (config: Config) => invoke<Result>('save_config', { config }),

  // ── Status / Logs (stubs until sidecar) ─────────────────────────────
  getStatus: () => invoke<StatusUpdate>('get_status'),
  getLogs: (envId: string) =>
    invoke<{ envLogs: string[]; resourceLogs: Record<string, string[]> }>('get_logs', { envId }),

  // ── Env lifecycle (stubs until sidecar) ─────────────────────────────
  startEnv: (envId: string) => invoke<Result>('start_env', { envId }),
  stopEnv: (envId: string) => invoke<Result>('stop_env', { envId }),
  restartEnv: (envId: string) => invoke<Result>('restart_env', { envId }),

  // ── Resource control (stubs until sidecar) ──────────────────────────
  triggerResource: (envId, resourceName) =>
    invoke<Result>('trigger_resource', { envId, resourceName }),
  enableResource: (envId, resourceName) =>
    invoke<Result>('enable_resource', { envId, resourceName }),
  disableResource: (envId, resourceName) =>
    invoke<Result>('disable_resource', { envId, resourceName }),

  // ── File operations ─────────────────────────────────────────────────
  pickTiltfile: async () => {
    // Use Tauri's file dialog
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
    const path = await openDialog({
      title: 'Select Tiltfile',
      multiple: false,
    });
    if (!path) return null;
    const filePath = typeof path === 'string' ? path : (path as unknown as { path: string }).path;
    return invoke<PickedTiltfile>('classify_tiltfile_path', { filePath });
  },

  classifyTiltfilePath: (filePath: string) =>
    invoke<PickedTiltfile>('classify_tiltfile_path', { filePath }),

  openExternal: async (url: string) => {
    await open(url);
  },

  getHomeDir: () => invoke<string>('get_home_dir'),
  readDir: (dirPath: string) => invoke<ReadDirResult>('read_dir', { dirPath }),

  discoverResources: (input) =>
    invoke<DiscoverResult>('discover_resources', {
      tiltfilePath: input.tiltfilePath,
      tiltPort: input.tiltPort,
      timeoutMs: input.timeoutMs,
    }),

  // ── Login items ─────────────────────────────────────────────────────
  getLoginItemSettings: () => invoke<LoginItemSettings>('get_login_item'),
  setLoginItemSettings: (openAtLogin: boolean) =>
    invoke<Result>('set_login_item', { openAtLogin }),

  // ── Events (will be emitted by sidecar in Phase 2) ──────────────────
  onStatusUpdate: (listener) => {
    let unlisten: (() => void) | null = null;
    listen<StatusUpdate>('status-update', (event) => {
      listener(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },

  onLogDelta: (listener) => {
    let unlisten: (() => void) | null = null;
    listen<LogDelta>('log-delta', (event) => {
      listener(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },

  onConfigUpdated: (listener) => {
    let unlisten: (() => void) | null = null;
    listen<Config>('config-updated', (event) => {
      listener(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  },
};
