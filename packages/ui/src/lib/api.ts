import { getBridge } from './bridge-provider.ts';
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

export async function fetchConfig(): Promise<Config> {
  return await getBridge().getConfig();
}

export async function fetchStatus(): Promise<StatusUpdate> {
  return await getBridge().getStatus();
}

export async function fetchLogs(
  envId: string,
): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }> {
  return await getBridge().getLogs(envId);
}

export async function startEnv(envId: string): Promise<Result> {
  return await getBridge().startEnv(envId);
}

export async function stopEnv(envId: string): Promise<Result> {
  return await getBridge().stopEnv(envId);
}

export async function restartEnv(envId: string): Promise<Result> {
  return await getBridge().restartEnv(envId);
}

export async function triggerResource(envId: string, resourceName: string): Promise<Result> {
  return await getBridge().triggerResource(envId, resourceName);
}

export async function enableResource(envId: string, resourceName: string): Promise<Result> {
  return await getBridge().enableResource(envId, resourceName);
}

export async function disableResource(envId: string, resourceName: string): Promise<Result> {
  return await getBridge().disableResource(envId, resourceName);
}

export async function saveConfig(config: Config): Promise<Result> {
  return await getBridge().saveConfig(config);
}

export async function pickTiltfile(): Promise<PickedTiltfile | null> {
  return await getBridge().pickTiltfile();
}

export async function classifyTiltfilePath(filePath: string): Promise<PickedTiltfile> {
  return await getBridge().classifyTiltfilePath(filePath);
}

export async function openExternal(url: string): Promise<void> {
  await getBridge().openExternal(url);
}

export async function getHomeDir(): Promise<string> {
  return await getBridge().getHomeDir();
}

export async function readDir(dirPath: string): Promise<ReadDirResult> {
  return await getBridge().readDir(dirPath);
}

export async function discoverResources(input: {
  tiltfilePath: string;
  tiltPort: number;
  timeoutMs?: number;
}): Promise<DiscoverResult> {
  return await getBridge().discoverResources(input);
}

export async function fetchLoginItemSettings(): Promise<LoginItemSettings> {
  return await getBridge().getLoginItemSettings();
}

export async function setLoginItemSettings(openAtLogin: boolean): Promise<Result> {
  return await getBridge().setLoginItemSettings(openAtLogin);
}

export function onStatusUpdate(listener: (update: StatusUpdate) => void): () => void {
  return getBridge().onStatusUpdate(listener);
}

export function onLogDelta(listener: (delta: LogDelta) => void): () => void {
  return getBridge().onLogDelta(listener);
}

export function onConfigUpdated(listener: (config: Config) => void): () => void {
  return getBridge().onConfigUpdated(listener);
}
