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
function bridge(): Window['tiltLauncher'] {
  if (!window.tiltLauncher) throw new Error('IPC bridge unavailable (window.tiltLauncher missing)');
  return window.tiltLauncher;
}

export async function fetchConfig(): Promise<Config> {
  return await bridge().getConfig();
}

export async function fetchStatus(): Promise<StatusUpdate> {
  return await bridge().getStatus();
}

export async function fetchLogs(envId: string): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }> {
  return await bridge().getLogs(envId);
}

export async function startEnv(envId: string): Promise<Result> {
  return await bridge().startEnv(envId);
}

export async function stopEnv(envId: string): Promise<Result> {
  return await bridge().stopEnv(envId);
}

export async function restartEnv(envId: string): Promise<Result> {
  return await bridge().restartEnv(envId);
}

export async function triggerResource(envId: string, resourceName: string): Promise<Result> {
  return await bridge().triggerResource(envId, resourceName);
}

export async function enableResource(envId: string, resourceName: string): Promise<Result> {
  return await bridge().enableResource(envId, resourceName);
}

export async function disableResource(envId: string, resourceName: string): Promise<Result> {
  return await bridge().disableResource(envId, resourceName);
}

export async function saveConfig(config: Config): Promise<Result> {
  return await bridge().saveConfig(config);
}

export async function pickTiltfile(): Promise<PickedTiltfile | null> {
  return await bridge().pickTiltfile();
}

export async function classifyTiltfilePath(filePath: string): Promise<PickedTiltfile> {
  return await bridge().classifyTiltfilePath(filePath);
}

export async function openExternal(url: string): Promise<void> {
  await bridge().openExternal(url);
}

export async function getHomeDir(): Promise<string> {
  return await bridge().getHomeDir();
}

export async function readDir(dirPath: string): Promise<ReadDirResult> {
  return await bridge().readDir(dirPath);
}

export async function discoverResources(input: {
  tiltfilePath: string;
  tiltPort: number;
  timeoutMs?: number;
}): Promise<DiscoverResult> {
  return await bridge().discoverResources(input);
}

export async function fetchLoginItemSettings(): Promise<LoginItemSettings> {
  return await bridge().getLoginItemSettings();
}

export async function setLoginItemSettings(openAtLogin: boolean): Promise<Result> {
  return await bridge().setLoginItemSettings(openAtLogin);
}

export function onStatusUpdate(listener: (update: StatusUpdate) => void): () => void {
  if (!window.tiltLauncher) return () => {};
  return window.tiltLauncher.onStatusUpdate(listener);
}

export function onLogDelta(listener: (delta: LogDelta) => void): () => void {
  if (!window.tiltLauncher) return () => {};
  return window.tiltLauncher.onLogDelta(listener);
}

export function onConfigUpdated(listener: (config: Config) => void): () => void {
  if (!window.tiltLauncher) return () => {};
  return window.tiltLauncher.onConfigUpdated(listener);
}
