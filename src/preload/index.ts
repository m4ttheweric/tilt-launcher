import { contextBridge, ipcRenderer } from 'electron';
import type {
  Config,
  DiscoverResult,
  LoginItemSettings,
  LogDelta,
  PickedTiltfile,
  ReadDirResult,
  StatusUpdate,
} from '../lib/types.ts';

type StartStopResult = { ok: boolean; error?: string };

const api = {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('launcher:get-config'),
  getStatus: (): Promise<StatusUpdate> => ipcRenderer.invoke('launcher:get-status'),
  getLogs: (envId: string): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }> =>
    ipcRenderer.invoke('launcher:get-logs', envId),
  startEnv: (envId: string): Promise<StartStopResult> => ipcRenderer.invoke('launcher:start-env', envId),
  stopEnv: (envId: string): Promise<StartStopResult> => ipcRenderer.invoke('launcher:stop-env', envId),
  restartEnv: (envId: string): Promise<StartStopResult> => ipcRenderer.invoke('launcher:restart-env', envId),
  triggerResource: (envId: string, resourceName: string): Promise<StartStopResult> =>
    ipcRenderer.invoke('launcher:trigger-resource', { envId, resourceName }),
  enableResource: (envId: string, resourceName: string): Promise<StartStopResult> =>
    ipcRenderer.invoke('launcher:enable-resource', { envId, resourceName }),
  disableResource: (envId: string, resourceName: string): Promise<StartStopResult> =>
    ipcRenderer.invoke('launcher:disable-resource', { envId, resourceName }),
  saveConfig: (config: Config): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('launcher:save-config', config),
  pickTiltfile: (): Promise<PickedTiltfile | null> => ipcRenderer.invoke('launcher:pick-tiltfile'),
  classifyTiltfilePath: (filePath: string): Promise<PickedTiltfile> =>
    ipcRenderer.invoke('launcher:classify-tiltfile-path', filePath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('launcher:open-external', url),
  getHomeDir: (): Promise<string> => ipcRenderer.invoke('launcher:get-home-dir'),
  readDir: (dirPath: string): Promise<ReadDirResult> => ipcRenderer.invoke('launcher:read-dir', dirPath),
  discoverResources: (input: { tiltfilePath: string; tiltPort: number; timeoutMs?: number }): Promise<DiscoverResult> =>
    ipcRenderer.invoke('launcher:discover-resources', input),
  getLoginItemSettings: (): Promise<LoginItemSettings> => ipcRenderer.invoke('launcher:get-login-item'),
  setLoginItemSettings: (openAtLogin: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('launcher:set-login-item', { openAtLogin }),

  /** Subscribe to config updates pushed from main process (e.g. external env cache) */
  onConfigUpdated: (listener: (config: Config) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, config: Config): void => listener(config);
    ipcRenderer.on('launcher:config-updated', wrapped);
    return (): void => {
      ipcRenderer.removeListener('launcher:config-updated', wrapped);
    };
  },

  /** Subscribe to status updates (resources + env state, no logs) */
  onStatusUpdate: (listener: (update: StatusUpdate) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, update: StatusUpdate): void => listener(update);
    ipcRenderer.on('launcher:status-update', wrapped);
    return (): void => {
      ipcRenderer.removeListener('launcher:status-update', wrapped);
    };
  },

  /** Subscribe to incremental log appends */
  onLogDelta: (listener: (delta: LogDelta) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, delta: LogDelta): void => listener(delta);
    ipcRenderer.on('launcher:log-delta', wrapped);
    return (): void => {
      ipcRenderer.removeListener('launcher:log-delta', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('tiltLauncher', api);

export type TiltLauncherApi = typeof api;
