import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell, type NativeImage } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Config, LogDelta, PickedTiltfile, ResourceRow, StatusUpdate } from '@tilt-launcher/sdk';

type EnvState = 'running' | 'starting' | 'stopped';

let config: Config = { environments: [] };
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ── Sidecar JSON-RPC Client ──────────────────────────────────────────────

let sidecarProc: ChildProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Locate the sidecar binary. In dev, use the workspace build. In production, use the bundled binary. */
function sidecarPath(): string {
  // In packaged app, look for the binary next to the asar
  const candidates = [
    join(app.getAppPath(), '..', 'sidecar', 'tilt-sidecar'),
    join(app.getAppPath(), '..', '..', 'packages', 'sidecar', 'dist', 'tilt-sidecar'),
    // Dev: workspace build
    join(process.cwd(), 'packages', 'sidecar', 'dist', 'tilt-sidecar'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Fallback — let PATH resolve it
  return 'tilt-sidecar';
}

function spawnSidecar(): void {
  const bin = sidecarPath();
  console.log(`[electron] Spawning sidecar: ${bin}`);

  sidecarProc = spawn(bin, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let buffer = '';
  const stdout = sidecarProc.stdout;
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
          // Response to a request
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
          // Push notification from sidecar
          handleSidecarNotification(msg.method, msg.params);
        }
      } catch {
        /* malformed line */
      }
    }
  });

  const stderr = sidecarProc.stderr;
  if (stderr) {
    stderr.setEncoding('utf-8');
    stderr.on('data', (chunk: string) => {
      console.error(`[sidecar stderr] ${chunk.trim()}`);
    });
  }

  sidecarProc.on('exit', (code, signal) => {
    console.log(`[electron] Sidecar exited (code=${code}, signal=${signal})`);
    sidecarProc = null;
    // Auto-restart unless we're quitting
    if (!quitting) {
      console.log('[electron] Restarting sidecar...');
      setTimeout(spawnSidecar, 1000);
    }
  });
}

/** Send a JSON-RPC request to the sidecar and return a promise for the result. */
function rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!sidecarProc || !sidecarProc.stdin) {
      reject(new Error('Sidecar not running'));
      return;
    }
    const id = nextId++;
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    const line = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
    sidecarProc.stdin.write(line + '\n');

    // Timeout after 60s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 60_000);
  });
}

/** Handle push notifications from the sidecar. */
function handleSidecarNotification(method: string, params: unknown): void {
  switch (method) {
    case 'statusUpdate': {
      const update = params as StatusUpdate;
      emitStatusUpdate(update);
      break;
    }
    case 'logDelta': {
      const delta = params as LogDelta;
      emitLogDelta(delta);
      break;
    }
    case 'configUpdated': {
      config = params as Config;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('launcher:config-updated', config);
      }
      break;
    }
    case 'ready':
      console.log('[electron] Sidecar ready');
      // Fetch initial config from sidecar
      void rpc<Config>('getConfig').then((cfg) => {
        config = cfg;
        void rpc<StatusUpdate>('getStatus').then((update) => {
          emitStatusUpdate(update);
        });
      });
      break;
  }
}

// ── Tray & Window ─────────────────────────────────────────────────────────

function serviceStatusLabel(status: ResourceRow['health']): string {
  if (status === 'up') return 'Up';
  if (status === 'down') return 'Down';
  if (status === 'missing') return 'Missing';
  return 'Unknown';
}

function envStateLabel(state: EnvState): string {
  if (state === 'running') return 'Running';
  if (state === 'starting') return 'Starting';
  return 'Stopped';
}

const statusIconCache = new Map<string, NativeImage | null>();

function namedStatusIcon(name: string): NativeImage | null {
  const key = `named:${name}`;
  const cached = statusIconCache.get(key);
  if (cached !== undefined) return cached;
  const icon = nativeImage.createFromNamedImage(name, [0, 0, 0]);
  if (icon.isEmpty()) {
    statusIconCache.set(key, null);
    return null;
  }
  icon.setTemplateImage(true);
  statusIconCache.set(key, icon);
  return icon;
}

function firstAvailableNamedIcon(names: string[]): NativeImage | undefined {
  for (const name of names) {
    const icon = namedStatusIcon(name);
    if (icon && !icon.isEmpty()) return icon;
  }
  return undefined;
}

function serviceStatusIcon(status: ResourceRow['health']): NativeImage | undefined {
  if (status === 'up') {
    return firstAvailableNamedIcon(['checkmark.circle.fill', 'checkmark.circle', 'NSMenuOnStateTemplate']);
  }
  if (status === 'missing') {
    return firstAvailableNamedIcon(['xmark.circle.fill', 'xmark.circle', 'NSStopProgressTemplate']);
  }
  if (status === 'down') {
    return firstAvailableNamedIcon(['xmark.circle', 'minus.circle', 'NSStatusUnavailable']);
  }
  return firstAvailableNamedIcon(['minus.circle', 'NSMenuMixedStateTemplate', 'NSStatusPartiallyAvailable']);
}

function envStateIcon(state: EnvState): NativeImage | undefined {
  if (state === 'running') {
    return firstAvailableNamedIcon(['play.fill', 'triangle.fill', 'NSGoRightTemplate']);
  }
  if (state === 'starting') {
    return firstAvailableNamedIcon(['arrow.triangle.2.circlepath', 'NSRefreshTemplate', 'NSStatusPartiallyAvailable']);
  }
  return firstAvailableNamedIcon(['stop.fill', 'pause.fill', 'NSStopProgressTemplate']);
}

function ensureWindowVisible(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu(update: StatusUpdate): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Tilt Launcher', enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => ensureWindowVisible() },
    { type: 'separator' },
  ];
  for (const env of config.environments) {
    const envStatus = update.envs[env.id];
    const state = envStatus?.status ?? 'stopped';
    items.push({
      label: env.name.toUpperCase(),
      enabled: false,
    });
    const tiltRowIcon = envStateIcon(state);
    items.push({
      label: `Tilt Dashboard — :${env.tiltPort} · ${envStateLabel(state)}`,
      ...(tiltRowIcon ? { icon: tiltRowIcon } : {}),
      click: () => void shell.openExternal(`http://localhost:${env.tiltPort}`),
    });
    const resources = envStatus?.resources ?? [];
    if (resources.length === 0) {
      items.push({
        label: 'No selected resources',
        enabled: false,
      });
    } else {
      for (const resource of resources) {
        const serviceIcon = serviceStatusIcon(resource.health);
        items.push({
          label: `${resource.label} — ${resource.port ? `:${resource.port}` : '—'} · ${serviceStatusLabel(resource.health)}`,
          ...(serviceIcon ? { icon: serviceIcon } : {}),
          enabled: Boolean(resource.endpoint),
          click: () => {
            if (resource.endpoint) void shell.openExternal(resource.endpoint);
          },
        });
      }
    }
    items.push({ type: 'separator' });
  }
  items.push({
    label: 'Launch at Login',
    type: 'checkbox',
    checked: app.getLoginItemSettings().openAtLogin,
    click: (menuItem) => {
      app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      void rpc<StatusUpdate>('getStatus').then((u) => emitStatusUpdate(u));
    },
  });
  items.push({
    label: 'Quit',
    click: () => {
      quitting = true;
      app.quit();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray(): void {
  if (tray) return;
  const iconCandidates = [join(app.getAppPath(), 'AppIcon.icns'), join(process.cwd(), 'AppIcon.icns')];
  let icon = nativeImage.createEmpty();
  for (const iconPath of iconCandidates) {
    if (!existsSync(iconPath)) continue;
    const candidate = nativeImage.createFromPath(iconPath);
    if (!candidate.isEmpty()) {
      icon = candidate.resize({ width: 18, height: 18 });
      break;
    }
  }
  if (icon.isEmpty()) {
    const svg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M9 3 L15 15 L3 15 Z" fill="black"/></svg>',
    );
    icon = nativeImage.createFromDataURL(`data:image/svg+xml,${svg}`);
    icon.setTemplateImage(true);
  }
  tray = new Tray(icon);
  if (icon.isEmpty()) {
    tray.setTitle('▲');
  }
  tray.setToolTip('Tilt Launcher');
  tray.on('click', () => ensureWindowVisible());
}

function emitStatusUpdate(update: StatusUpdate): void {
  updateTrayMenu(update);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:status-update', update);
  }
}

function emitLogDelta(delta: LogDelta): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:log-delta', delta);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: 'Tilt Launcher',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 11 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────
// All commands proxy through the sidecar via JSON-RPC.
// Shell-specific commands (pickTiltfile, openExternal, loginItem) are handled
// locally since they depend on Electron APIs.

function registerIpcHandlers(): void {
  // Proxied to sidecar
  ipcMain.handle('launcher:get-config', () => rpc('getConfig'));
  ipcMain.handle('launcher:get-status', () => rpc('getStatus'));
  ipcMain.handle('launcher:get-logs', (_event, envId: string) => rpc('getLogs', { envId }));
  ipcMain.handle('launcher:start-env', (_event, envId: string) => rpc('startEnv', { envId }));
  ipcMain.handle('launcher:stop-env', (_event, envId: string) => rpc('stopEnv', { envId }));
  ipcMain.handle('launcher:restart-env', (_event, envId: string) => rpc('restartEnv', { envId }));
  ipcMain.handle('launcher:trigger-resource', (_event, payload: { envId: string; resourceName: string }) =>
    rpc('triggerResource', payload),
  );
  ipcMain.handle('launcher:enable-resource', (_event, payload: { envId: string; resourceName: string }) =>
    rpc('enableResource', payload),
  );
  ipcMain.handle('launcher:disable-resource', (_event, payload: { envId: string; resourceName: string }) =>
    rpc('disableResource', payload),
  );
  ipcMain.handle('launcher:save-config', async (_event, nextConfig: Config) => {
    const result = await rpc<{ ok: boolean; error?: string }>('saveConfig', { config: nextConfig });
    if (result.ok) {
      // Re-fetch config to get the normalized version
      config = await rpc<Config>('getConfig');
    }
    return result;
  });

  // Shell-specific: file picker
  ipcMain.handle('launcher:pick-tiltfile', async (): Promise<PickedTiltfile | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Tiltfile',
      properties: ['openFile'],
      filters: [{ name: 'Tiltfile', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0] ?? '';
    // Classify via sidecar (handles symlink detection + reverse-mapping)
    return rpc<PickedTiltfile>('classifyTiltfilePath', { filePath });
  });

  // Proxied to sidecar
  ipcMain.handle('launcher:classify-tiltfile-path', (_event, filePath: string) =>
    rpc('classifyTiltfilePath', { filePath }),
  );

  ipcMain.handle(
    'launcher:discover-resources',
    (_event, payload: { tiltfilePath: string; tiltPort: number; timeoutMs?: number }) =>
      rpc('discoverResources', payload),
  );

  // Shell-specific: login item (uses Electron API)
  ipcMain.handle('launcher:get-login-item', () => {
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('launcher:set-login-item', (_event, payload: { openAtLogin: boolean }) => {
    app.setLoginItemSettings({ openAtLogin: payload.openAtLogin });
    void rpc<StatusUpdate>('getStatus').then((u) => emitStatusUpdate(u));
    return { ok: true };
  });

  // Shell-specific: open external URL
  ipcMain.handle('launcher:open-external', (_event, url: string) => shell.openExternal(url));

  // Proxied to sidecar
  ipcMain.handle('launcher:get-home-dir', () => rpc('getHomeDir'));
  ipcMain.handle('launcher:read-dir', (_event, dirPath: string) => rpc('readDir', { dirPath }));
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tiltlauncher.electron');
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  registerIpcHandlers();
  createTray();
  createWindow();
  spawnSidecar();

  app.on('activate', () => {
    ensureWindowVisible();
  });

  app.on('second-instance', () => {
    ensureWindowVisible();
  });
});

app.on('window-all-closed', () => {
  // Keep tray app active on all platforms until explicit quit.
});

app.on('before-quit', () => {
  quitting = true;
  // Close the sidecar process (which will stop polling but leave Tilt running)
  if (sidecarProc) {
    sidecarProc.stdin?.end();
    sidecarProc.kill('SIGTERM');
  }
});
