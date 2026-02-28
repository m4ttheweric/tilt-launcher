import { getBridge, onBridgeReady } from './bridge-provider.ts';
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

function requireBridge() {
  const b = getBridge();
  if (!b) throw new Error('Bridge not ready');
  return b;
}

export async function fetchConfig(): Promise<Config> {
  return requireBridge().getConfig();
}

export async function fetchStatus(): Promise<StatusUpdate> {
  return requireBridge().getStatus();
}

export async function fetchLogs(
  envId: string,
): Promise<{ envLogs: string[]; resourceLogs: Record<string, string[]> }> {
  return requireBridge().getLogs(envId);
}

export async function startEnv(envId: string): Promise<Result> {
  return requireBridge().startEnv(envId);
}

export async function stopEnv(envId: string): Promise<Result> {
  return requireBridge().stopEnv(envId);
}

export async function restartEnv(envId: string): Promise<Result> {
  return requireBridge().restartEnv(envId);
}

export async function triggerResource(envId: string, resourceName: string): Promise<Result> {
  return requireBridge().triggerResource(envId, resourceName);
}

export async function enableResource(envId: string, resourceName: string): Promise<Result> {
  return requireBridge().enableResource(envId, resourceName);
}

export async function disableResource(envId: string, resourceName: string): Promise<Result> {
  return requireBridge().disableResource(envId, resourceName);
}

export async function saveConfig(config: Config): Promise<Result> {
  return requireBridge().saveConfig(config);
}

export async function pickTiltfile(): Promise<PickedTiltfile | null> {
  return requireBridge().pickTiltfile();
}

export async function classifyTiltfilePath(filePath: string): Promise<PickedTiltfile> {
  return requireBridge().classifyTiltfilePath(filePath);
}

export async function openExternal(url: string): Promise<void> {
  await requireBridge().openExternal(url);
}

export async function getHomeDir(): Promise<string> {
  return requireBridge().getHomeDir();
}

export async function readDir(dirPath: string): Promise<ReadDirResult> {
  return requireBridge().readDir(dirPath);
}

export async function discoverResources(input: {
  tiltfilePath: string;
  tiltPort: number;
  timeoutMs?: number;
}): Promise<DiscoverResult> {
  return requireBridge().discoverResources(input);
}

export async function fetchLoginItemSettings(): Promise<LoginItemSettings> {
  return requireBridge().getLoginItemSettings();
}

export async function setLoginItemSettings(openAtLogin: boolean): Promise<Result> {
  return requireBridge().setLoginItemSettings(openAtLogin);
}

export function onStatusUpdate(listener: (update: StatusUpdate) => void): () => void {
  const b = getBridge();
  if (b) return b.onStatusUpdate(listener);
  let cleanup: (() => void) | null = null;
  onBridgeReady((bridge) => {
    cleanup = bridge.onStatusUpdate(listener);
  });
  return () => { cleanup?.(); };
}

export function onLogDelta(listener: (delta: LogDelta) => void): () => void {
  const b = getBridge();
  if (b) return b.onLogDelta(listener);
  let cleanup: (() => void) | null = null;
  onBridgeReady((bridge) => {
    cleanup = bridge.onLogDelta(listener);
  });
  return () => { cleanup?.(); };
}

export function onConfigUpdated(listener: (config: Config) => void): () => void {
  const b = getBridge();
  if (b) return b.onConfigUpdated(listener);
  let cleanup: (() => void) | null = null;
  onBridgeReady((bridge) => {
    cleanup = bridge.onConfigUpdated(listener);
  });
  return () => { cleanup?.(); };
}
