import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { setBridge } from '$lib/bridge-provider.ts';

// Detect Electron bridge (synchronous — preload sets window.tiltLauncher).
if ('tiltLauncher' in window) {
  setBridge((window as unknown as Record<string, unknown>).tiltLauncher as import('@tilt-launcher/sdk').LauncherBridge);
}

// Mount the app immediately — always responsive.
const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');
mount(App, { target });

// Detect Tauri bridge (async — load from npm packages).
if ('__TAURI_INTERNALS__' in window) {
  Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-opener'),
    import('@tauri-apps/plugin-dialog'),
  ])
    .then(([{ invoke }, { listen }, { openUrl }, { open: openDialog }]) => {
      setBridge({
        getConfig: () => invoke('get_config'),
        saveConfig: (config: any) => invoke('save_config', { config }),
        getStatus: () => invoke('get_status'),
        getLogs: (envId: string) => invoke('get_logs', { envId }),
        startEnv: (envId: string) => invoke('start_env', { envId }),
        stopEnv: (envId: string) => invoke('stop_env', { envId }),
        restartEnv: (envId: string) => invoke('restart_env', { envId }),
        triggerResource: (envId: string, resourceName: string) => invoke('trigger_resource', { envId, resourceName }),
        enableResource: (envId: string, resourceName: string) => invoke('enable_resource', { envId, resourceName }),
        disableResource: (envId: string, resourceName: string) => invoke('disable_resource', { envId, resourceName }),
        pickTiltfile: async () => {
          const path = await openDialog({ title: 'Select Tiltfile', multiple: false });
          if (!path) return null;
          const filePath = typeof path === 'string' ? path : (path as any).path;
          return invoke('classify_tiltfile_path', { filePath });
        },
        classifyTiltfilePath: (filePath: string) => invoke('classify_tiltfile_path', { filePath }),
        openExternal: async (url: string) => {
          await openUrl(url);
        },
        getHomeDir: () => invoke('get_home_dir'),
        readDir: (dirPath: string) => invoke('read_dir', { dirPath }),
        discoverResources: (input: any) =>
          invoke('discover_resources', {
            tiltfilePath: input.tiltfilePath,
            tiltPort: input.tiltPort,
            timeoutMs: input.timeoutMs,
          }),
        getLoginItemSettings: () => invoke('get_login_item'),
        setLoginItemSettings: (openAtLogin: boolean) => invoke('set_login_item', { openAtLogin }),
        onStatusUpdate: (listener: any) => {
          let unlisten: (() => void) | null = null;
          listen('status-update', (e: any) => listener(e.payload)).then((fn: any) => {
            unlisten = fn;
          });
          return () => {
            unlisten?.();
          };
        },
        onLogDelta: (listener: any) => {
          let unlisten: (() => void) | null = null;
          listen('log-delta', (e: any) => listener(e.payload)).then((fn: any) => {
            unlisten = fn;
          });
          return () => {
            unlisten?.();
          };
        },
        onConfigUpdated: (listener: any) => {
          let unlisten: (() => void) | null = null;
          listen('config-updated', (e: any) => listener(e.payload)).then((fn: any) => {
            unlisten = fn;
          });
          return () => {
            unlisten?.();
          };
        },
      } as import('@tilt-launcher/sdk').LauncherBridge);
    })
    .catch(console.error);
}
