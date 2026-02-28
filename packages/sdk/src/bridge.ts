import type {
  Config,
  DiscoverResult,
  LoginItemSettings,
  LogDelta,
  PickedTiltfile,
  ReadDirResult,
  StatusUpdate,
} from './types.ts';

type Result = { ok: boolean; error?: string };

/**
 * Abstract bridge interface between the UI and the host shell.
 *
 * Each shell (Electron, Tauri, etc.) provides its own implementation.
 * The UI layer consumes this interface exclusively — it never imports
 * from Electron, Tauri, or any other shell-specific API directly.
 */
export interface LauncherBridge {
  // ── Request / Response commands ─────────────────────────────────────
  getConfig(): Promise<Config>;
  getStatus(): Promise<StatusUpdate>;
  getLogs(envId: string): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }>;
  startEnv(envId: string): Promise<Result>;
  stopEnv(envId: string): Promise<Result>;
  restartEnv(envId: string): Promise<Result>;
  triggerResource(envId: string, resourceName: string): Promise<Result>;
  enableResource(envId: string, resourceName: string): Promise<Result>;
  disableResource(envId: string, resourceName: string): Promise<Result>;
  saveConfig(config: Config): Promise<Result>;
  pickTiltfile(): Promise<PickedTiltfile | null>;
  classifyTiltfilePath(filePath: string): Promise<PickedTiltfile>;
  openExternal(url: string): Promise<void>;
  getHomeDir(): Promise<string>;
  readDir(dirPath: string): Promise<ReadDirResult>;
  discoverResources(input: {
    tiltfilePath: string;
    tiltPort: number;
    timeoutMs?: number;
  }): Promise<DiscoverResult>;
  getLoginItemSettings(): Promise<LoginItemSettings>;
  setLoginItemSettings(openAtLogin: boolean): Promise<Result>;

  // ── Event subscriptions ─────────────────────────────────────────────
  onStatusUpdate(listener: (update: StatusUpdate) => void): () => void;
  onLogDelta(listener: (delta: LogDelta) => void): () => void;
  onConfigUpdated(listener: (config: Config) => void): () => void;
}
