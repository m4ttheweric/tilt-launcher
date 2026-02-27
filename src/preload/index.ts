import { contextBridge, ipcRenderer } from 'electron';
import type {
  Config,
  DiscoverResult,
  LoginItemSettings,
  PickedTiltfile,
  ReadDirResult,
  StatusResponse,
} from '../lib/types.ts';

type StartStopResult = { ok: boolean; error?: string };

const api = {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('launcher:get-config'),
  getStatus: (): Promise<StatusResponse> => ipcRenderer.invoke('launcher:get-status'),
  startEnv: (envId: string): Promise<StartStopResult> => ipcRenderer.invoke('launcher:start-env', envId),
  stopEnv: (envId: string): Promise<StartStopResult> => ipcRenderer.invoke('launcher:stop-env', envId),
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
  onStatusUpdated: (listener: (status: StatusResponse) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: StatusResponse): void => listener(status);
    ipcRenderer.on('launcher:status-updated', wrapped);
    return (): void => {
      ipcRenderer.removeListener('launcher:status-updated', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('tiltLauncher', api);

export type TiltLauncherApi = typeof api;
