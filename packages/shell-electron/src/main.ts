import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell, type NativeImage } from 'electron';
import { electronApp, optimizer } from '@electron-toolkit/utils';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import type {
  Config,
  DirEntry,
  LogDelta,
  PickedTiltfile,
  ReadDirResult,
  ResourceRow,
  StatusUpdate,
} from '@tilt-launcher/sdk';
import { TiltManagerSDK } from '@tilt-launcher/sdk';

type EnvState = 'running' | 'starting' | 'stopped';

const CONFIG_DIR = join(homedir(), '.config', 'tilt-launcher');
const CONFIG_PATH = process.env.TILT_LAUNCHER_CONFIG || join(CONFIG_DIR, 'config.json');
const DEFAULT_PORT = 10400;

let config: Config = loadConfig();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let configSaveTimer: NodeJS.Timeout | null = null;
const tiltManager = new TiltManagerSDK(config, {
  onStatusUpdate: (update) => emitStatusUpdate(update),
  onLogDelta: (delta) => emitLogDelta(delta),
  onConfigMutated: (mutated) => {
    config = mutated;
    // Debounce saves — external env resources update every poll cycle
    if (configSaveTimer) clearTimeout(configSaveTimer);
    configSaveTimer = setTimeout(() => {
      writeConfig(config);
      mainWindow?.webContents.send('launcher:config-updated', JSON.parse(JSON.stringify(config)));
    }, 5000);
  },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadConfig(): Config {
  mkdirSync(CONFIG_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config;
    return normalizeConfig(parsed);
  } catch {
    const examplePath = join(app.getAppPath(), 'config.example.json');
    const fallback = existsSync(examplePath)
      ? (JSON.parse(readFileSync(examplePath, 'utf-8')) as Config)
      : ({ port: DEFAULT_PORT, environments: [] } as Config);
    const normalized = normalizeConfig(fallback);
    writeConfig(normalized);
    return normalized;
  }
}

function normalizeConfig(raw: Config): Config {
  const used = new Set<string>();
  const environments = raw.environments.map((env, idx) => {
    const id = env.id && env.id.length > 0 ? env.id : slugify(env.name || `env-${idx + 1}`) || `env-${idx + 1}`;
    let unique = id;
    let suffix = 2;
    while (used.has(unique)) {
      unique = `${id}-${suffix++}`;
    }
    used.add(unique);
    return {
      ...env,
      id: unique,
      external: env.external ?? false,
      description: env.description ?? '',
      selectedResources: env.selectedResources ?? [],
      cachedResources: env.cachedResources ?? [],
      serviceMapping: env.serviceMapping,
    };
  });
  return {
    port: raw.port ?? DEFAULT_PORT,
    dashboardUrl: raw.dashboardUrl,
    themeMode: raw.themeMode ?? 'system',
    environments,
  };
}

function writeConfig(next: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmpPath = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(next, null, 2));
  renameSync(tmpPath, CONFIG_PATH);
}

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
      emitStatusUpdate();
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

function emitStatusUpdate(update?: StatusUpdate): void {
  const next = update ?? tiltManager.currentStatusUpdate();
  updateTrayMenu(next);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:status-update', next);
  }
}

function emitLogDelta(delta: LogDelta): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:log-delta', delta);
  }
}

/**
 * macOS NSOpenPanel resolves POSIX symlinks before returning paths, so
 * `filePath` is often the real file rather than the symlink the user navigated
 * to.  This mirrors the runway `resolveToWorkspace` strategy: given the real
 * path, scan a set of likely roots for a symlink whose realpath matches the
 * file's containing directory, then remap the path through it.
 */
function findSymlinkFor(realFilePath: string): string | null {
  const realDir = dirname(realFilePath);
  const filename = basename(realFilePath);

  // Candidate roots to scan for directory symlinks that point to realDir.
  const scanRoots = [
    dirname(realDir), // siblings of the real directory
    join(homedir(), 'Documents', 'GitHub'),
    join(homedir(), 'Documents', 'Projects'),
    join(homedir(), 'repos'),
    join(homedir(), 'projects'),
    join(homedir(), 'src'),
    join(homedir(), 'dev'),
    join(homedir(), 'code'),
    join(homedir(), 'workspace'),
  ];

  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot)) continue;
    try {
      for (const entry of readdirSync(scanRoot)) {
        const entryPath = join(scanRoot, entry);
        try {
          const entryStat = lstatSync(entryPath);
          if (!entryStat.isSymbolicLink()) continue;
          const entryReal = realpathSync(entryPath);
          // Directory symlink whose target is realDir → remap file path through it
          if (entryReal === realDir) return join(entryPath, filename);
          // File symlink pointing directly to our file
          if (entryReal === realFilePath) return entryPath;
          // Symlink whose target is an ancestor of realDir → remap deeper path
          const rel = relative(entryReal, realFilePath);
          if (!rel.startsWith('..')) return join(entryPath, rel);
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

function classifyTiltfilePath(filePath: string): PickedTiltfile {
  // Case 1: dialog handed us the symlink path directly (uncommon on macOS but possible)
  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      return { path: filePath, isSymlink: true, realPath: realpathSync(filePath) };
    }
  } catch {
    /* ignore */
  }

  // Case 2: macOS resolved the symlink — try to reverse-map back to the symlink
  const symlinkPath = findSymlinkFor(filePath);
  if (symlinkPath) {
    return { path: symlinkPath, isSymlink: true, realPath: filePath };
  }

  return { path: filePath, isSymlink: false };
}

function ensureUniquePorts(next: Config): string | null {
  const seen = new Map<number, string>();
  for (const env of next.environments) {
    const owner = seen.get(env.tiltPort);
    if (owner) return `Port ${env.tiltPort} is used by both ${owner} and ${env.name}.`;
    seen.set(env.tiltPort, env.name);
  }
  return null;
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

function registerIpcHandlers(): void {
  ipcMain.handle('launcher:get-config', () => config);
  ipcMain.handle('launcher:get-status', () => tiltManager.currentStatusUpdate());
  ipcMain.handle('launcher:get-logs', (_event, envId: string) => tiltManager.getEnvLogs(envId));
  ipcMain.handle('launcher:start-env', (_event, envId: string) => tiltManager.startEnv(envId));
  ipcMain.handle('launcher:stop-env', (_event, envId: string) => tiltManager.stopEnv(envId));
  ipcMain.handle('launcher:restart-env', (_event, envId: string) => tiltManager.restartEnv(envId));
  ipcMain.handle('launcher:trigger-resource', (_event, payload: { envId: string; resourceName: string }) =>
    tiltManager.triggerResource(payload.envId, payload.resourceName),
  );
  ipcMain.handle('launcher:enable-resource', (_event, payload: { envId: string; resourceName: string }) =>
    tiltManager.enableResource(payload.envId, payload.resourceName),
  );
  ipcMain.handle('launcher:disable-resource', (_event, payload: { envId: string; resourceName: string }) =>
    tiltManager.disableResource(payload.envId, payload.resourceName),
  );
  ipcMain.handle('launcher:save-config', (_event, nextConfig: Config) => {
    const normalized = normalizeConfig(nextConfig);
    const conflict = ensureUniquePorts(normalized);
    if (conflict) return { ok: false, error: conflict };
    config = normalized;
    tiltManager.setConfig(config);
    writeConfig(config);
    emitStatusUpdate();
    return { ok: true };
  });
  ipcMain.handle('launcher:pick-tiltfile', async (): Promise<PickedTiltfile | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Tiltfile',
      properties: ['openFile'],
      filters: [{ name: 'Tiltfile', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0] ?? '';
    return classifyTiltfilePath(filePath);
  });
  ipcMain.handle('launcher:classify-tiltfile-path', (_event, filePath: string): PickedTiltfile => {
    return classifyTiltfilePath(expandHome(filePath));
  });
  ipcMain.handle(
    'launcher:discover-resources',
    (_event, payload: { tiltfilePath: string; tiltPort: number; timeoutMs?: number }) =>
      tiltManager.discoverResources(payload),
  );
  ipcMain.handle('launcher:get-login-item', () => {
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('launcher:set-login-item', (_event, payload: { openAtLogin: boolean }) => {
    app.setLoginItemSettings({ openAtLogin: payload.openAtLogin });
    emitStatusUpdate();
    return { ok: true };
  });
  ipcMain.handle('launcher:open-external', (_event, url: string) => shell.openExternal(url));
  ipcMain.handle('launcher:get-home-dir', () => homedir());
  ipcMain.handle('launcher:read-dir', (_event, dirPath: string): ReadDirResult => {
    const resolvedDir = expandHome(dirPath);
    try {
      const rawNames = readdirSync(resolvedDir);
      const entries: DirEntry[] = [];
      for (const name of rawNames) {
        if (name.startsWith('.')) continue;
        const fullPath = join(resolvedDir, name);
        try {
          const lstat = lstatSync(fullPath);
          const isSymlink = lstat.isSymbolicLink();
          let isDirectory = lstat.isDirectory();
          let isFile = lstat.isFile();
          let symlinkTarget: string | undefined;
          let realPath: string | undefined;
          if (isSymlink) {
            try {
              symlinkTarget = readlinkSync(fullPath);
            } catch {
              /* ignore */
            }
            try {
              realPath = realpathSync(fullPath);
              const resolved = statSync(fullPath); // follows the symlink
              isDirectory = resolved.isDirectory();
              isFile = resolved.isFile();
            } catch {
              isFile = true; /* broken symlink */
            }
          }
          entries.push({ name, isDirectory, isFile, isSymlink, symlinkTarget, realPath });
        } catch {
          continue;
        }
      }
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { ok: true, path: resolvedDir, entries };
    } catch (e) {
      return {
        ok: false,
        path: resolvedDir,
        entries: [],
        error: e instanceof Error ? e.message : 'Failed to read directory',
      };
    }
  });
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tiltlauncher.electron');
  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  registerIpcHandlers();
  createTray();
  createWindow();
  tiltManager.startPolling();
  emitStatusUpdate();

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
  tiltManager.stopPolling();
  // Match legacy launcher behavior: quitting the app does not stop Tilt.
});
