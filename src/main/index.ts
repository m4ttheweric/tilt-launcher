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
import { spawn, type ChildProcess } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import type {
  CachedResource,
  Config,
  DirEntry,
  DiscoverResult,
  Environment,
  PickedTiltfile,
  ReadDirResult,
  ResourceRow,
  StatusResponse,
} from '../lib/types.ts';

type EnvState = 'running' | 'starting' | 'stopped';

const CONFIG_DIR = join(homedir(), '.config', 'tilt-launcher');
const CONFIG_PATH = process.env.TILT_LAUNCHER_CONFIG || join(CONFIG_DIR, 'config.json');
const DEFAULT_PORT = 10400;
const MAX_LOG_LINES = 800;

const processes = new Map<string, ChildProcess>();
const logs = new Map<string, string[]>();
const startTimes = new Map<string, number>();
const discoveredResources = new Map<string, CachedResource[]>();
const healthByKey = new Map<string, ResourceRow['health']>();
const newResourceCount = new Map<string, number>();

let config: Config = loadConfig();
let pollHandle: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

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
      description: env.description ?? '',
      selectedResources: env.selectedResources ?? [],
      cachedResources: env.cachedResources ?? [],
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

function appendLog(envId: string, line: string): void {
  const existing = logs.get(envId) ?? [];
  existing.push(line);
  logs.set(envId, existing.slice(-MAX_LOG_LINES));
}

function envById(envId: string): Environment | undefined {
  return config.environments.find((env) => env.id === envId);
}

function getEnvState(env: Environment): EnvState {
  const proc = processes.get(env.id);
  if (proc && proc.exitCode === null && !proc.killed) return 'starting';
  const resources = discoveredResources.get(env.id) ?? [];
  if (resources.some((resource) => resource.runtimeStatus === 'ok')) return 'running';
  return 'stopped';
}

function parseEndpoint(endpoint?: string): { port?: number; path?: string } {
  if (!endpoint) return {};
  try {
    const url = new URL(endpoint);
    return {
      port: Number(url.port || 80),
      path: url.pathname || '/',
    };
  } catch {
    return {};
  }
}

function categoryFor(resource: CachedResource): string {
  if (resource.category) return resource.category;
  if (resource.runtimeStatus === 'not_applicable') return 'on-demand';
  return 'services';
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
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

async function readTiltResources(env: Environment): Promise<CachedResource[] | null> {
  const result = await runCommand(
    'tilt',
    ['get', 'uiresources', '-o', 'json', '--port', String(env.tiltPort)],
    env.repoDir,
  );
  if (result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.output) as {
      items?: Array<{
        metadata?: { name?: string; labels?: Record<string, string> };
        status?: {
          endpointLinks?: Array<{ url?: string }>;
          runtimeStatus?: string;
          specs?: Array<{ type?: string }>;
        };
      }>;
    };
    return (parsed.items ?? [])
      .filter((item) => item.metadata?.name && item.metadata.name !== '(Tiltfile)')
      .map((item) => {
        const endpoint = item.status?.endpointLinks?.[0]?.url;
        const parsedEndpoint = parseEndpoint(endpoint);
        const labels = item.metadata?.labels ? Object.keys(item.metadata.labels) : [];
        return {
          name: item.metadata?.name ?? 'unknown',
          label: item.metadata?.name ?? 'unknown',
          category: labels[0] ?? 'services',
          type: item.status?.specs?.[0]?.type ?? 'unknown',
          endpoint,
          port: parsedEndpoint.port,
          path: parsedEndpoint.path,
          runtimeStatus: item.status?.runtimeStatus ?? 'unknown',
        };
      });
  } catch {
    return null;
  }
}

async function tryConnect(hostname: string, port: number, path = '/'): Promise<boolean> {
  return await new Promise((resolve) => {
    const req = spawn('curl', ['-sS', '-o', '/dev/null', '-m', '1.5', `http://${hostname}:${port}${path}`], {
      stdio: 'ignore',
    });
    req.on('close', (code) => resolve(code === 0));
    req.on('error', () => resolve(false));
  });
}

async function computeHealth(resource: CachedResource): Promise<ResourceRow['health']> {
  if (!resource.port) return 'unknown';
  const path = resource.path ?? '/';
  const ok = (await tryConnect('127.0.0.1', resource.port, path)) || (await tryConnect('::1', resource.port, path));
  return ok ? 'up' : 'down';
}

function getDisplayRows(env: Environment): ResourceRow[] {
  const selected = env.selectedResources ?? [];
  const discovered = discoveredResources.get(env.id) ?? [];
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
        health: 'missing',
        exists: false,
        error: `Resource '${name}' not found in Tiltfile output.`,
      };
    }
    return {
      key,
      name: found.name,
      label: found.label || found.name,
      category: categoryFor(found),
      endpoint: found.endpoint,
      port: found.port,
      path: found.path,
      runtimeStatus: found.runtimeStatus ?? 'unknown',
      health: healthByKey.get(key) ?? 'unknown',
      exists: true,
    };
  });
}

function currentStatusSnapshot(): StatusResponse {
  const envs: StatusResponse['envs'] = {};
  for (const env of config.environments) {
    envs[env.id] = {
      status: getEnvState(env),
      logs: logs.get(env.id) ?? [],
      tiltPort: env.tiltPort,
      uptime: startTimes.has(env.id) ? Date.now() - (startTimes.get(env.id) ?? Date.now()) : null,
      newResources: newResourceCount.get(env.id) ?? 0,
      resources: getDisplayRows(env),
    };
  }
  return { envs };
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

function updateTrayMenu(snapshot: StatusResponse): void {
  if (!tray) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Tilt Launcher', enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => ensureWindowVisible() },
    { type: 'separator' },
  ];
  for (const env of config.environments) {
    const envStatus = snapshot.envs[env.id];
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
      emitStatus();
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

function emitStatus(): void {
  const snapshot = currentStatusSnapshot();
  updateTrayMenu(snapshot);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('launcher:status-updated', snapshot);
  }
}

async function pollTiltState(): Promise<void> {
  for (const env of config.environments) {
    const resources = await readTiltResources(env);
    if (!resources) {
      continue;
    }
    discoveredResources.set(env.id, resources);
    const selected = new Set(env.selectedResources ?? []);
    newResourceCount.set(env.id, resources.filter((resource) => !selected.has(resource.name)).length);
    const nextCached = [...resources];
    env.cachedResources = nextCached;
    for (const resource of resources) {
      const key = `${env.id}:${resource.name}`;
      healthByKey.set(key, await computeHealth(resource));
    }
  }
  // Keep polled discovery data in-memory; only persist config on explicit save.
  emitStatus();
}

function startPolling(): void {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => {
    void pollTiltState();
  }, 5000);
  void pollTiltState();
}

function startEnv(envId: string): { ok: boolean; error?: string } {
  const env = envById(envId);
  if (!env) return { ok: false, error: 'Unknown environment.' };
  const state = getEnvState(env);
  if (state === 'running' || state === 'starting') return { ok: false, error: 'Environment already active.' };

  appendLog(env.id, `[launcher] Starting ${env.name}...`);
  appendLog(env.id, `[launcher] tilt up -f ${env.tiltfile} --port ${env.tiltPort}`);
  const child = spawn('tilt', ['up', '-f', env.tiltfile, '--port', String(env.tiltPort)], {
    cwd: env.repoDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PWD: env.repoDir },
  });
  child.unref();
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) appendLog(env.id, line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) appendLog(env.id, line);
  });
  child.on('close', (code) => {
    appendLog(env.id, `[launcher] Process exited with code ${code ?? 0}`);
    processes.delete(env.id);
    emitStatus();
  });
  child.on('error', (error: Error) => {
    appendLog(env.id, `[launcher] ${error.message}`);
    processes.delete(env.id);
    emitStatus();
  });
  processes.set(env.id, child);
  startTimes.set(env.id, Date.now());
  emitStatus();
  return { ok: true };
}

function stopEnv(envId: string): { ok: boolean; error?: string } {
  const env = envById(envId);
  if (!env) return { ok: false, error: 'Unknown environment.' };
  appendLog(env.id, `[launcher] Stopping ${env.name}...`);

  void runCommand('lsof', ['-ti', `tcp:${env.tiltPort}`], env.repoDir).then((result) => {
    if (!result.output.trim()) return;
    for (const line of result.output.trim().split('\n')) {
      const pid = Number(line.trim());
      if (Number.isFinite(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // already stopped
        }
      }
    }
  });

  const tracked = processes.get(env.id);
  if (tracked?.pid) {
    try {
      process.kill(-tracked.pid, 'SIGTERM');
    } catch {
      try {
        tracked.kill('SIGTERM');
      } catch {
        // noop
      }
    }
  }
  void runCommand('tilt', ['down', '--port', String(env.tiltPort)], env.repoDir);
  processes.delete(env.id);
  startTimes.delete(env.id);
  emitStatus();
  return { ok: true };
}

async function discoverResources(input: {
  tiltfilePath: string;
  tiltPort: number;
  timeoutMs?: number;
}): Promise<DiscoverResult> {
  const repoDir = dirname(input.tiltfilePath);
  const tiltfile = basename(input.tiltfilePath);
  const timeoutMs = input.timeoutMs ?? 30000;
  const logsOut: string[] = [];

  const discoveryProc = spawn('tilt', ['up', '-f', tiltfile, '--port', String(input.tiltPort)], {
    cwd: repoDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PWD: repoDir },
  });

  discoveryProc.stdout.on('data', (chunk: Buffer) => {
    logsOut.push(...chunk.toString().split('\n').filter(Boolean));
  });
  discoveryProc.stderr.on('data', (chunk: Buffer) => {
    logsOut.push(...chunk.toString().split('\n').filter(Boolean));
  });

  const startedAt = Date.now();
  let resources: CachedResource[] | null = null;
  while (Date.now() - startedAt < timeoutMs) {
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
    resources = await readTiltResources(env);
    if (resources && resources.length > 0) break;
  }

  void runCommand('tilt', ['down', '--port', String(input.tiltPort)], repoDir);
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
      preload: join(__dirname, '../preload/index.mjs'),
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
  ipcMain.handle('launcher:get-status', () => currentStatusSnapshot());
  ipcMain.handle('launcher:start-env', (_event, envId: string) => startEnv(envId));
  ipcMain.handle('launcher:stop-env', (_event, envId: string) => stopEnv(envId));
  ipcMain.handle('launcher:save-config', (_event, nextConfig: Config) => {
    const normalized = normalizeConfig(nextConfig);
    const conflict = ensureUniquePorts(normalized);
    if (conflict) return { ok: false, error: conflict };
    config = normalized;
    writeConfig(config);
    emitStatus();
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
    (_event, payload: { tiltfilePath: string; tiltPort: number; timeoutMs?: number }) => discoverResources(payload),
  );
  ipcMain.handle('launcher:get-login-item', () => {
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('launcher:set-login-item', (_event, payload: { openAtLogin: boolean }) => {
    app.setLoginItemSettings({ openAtLogin: payload.openAtLogin });
    emitStatus();
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
  startPolling();
  emitStatus();

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
  if (pollHandle) clearInterval(pollHandle);
  for (const envId of processes.keys()) {
    stopEnv(envId);
  }
});
