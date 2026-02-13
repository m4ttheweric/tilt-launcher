import type { Config, StatusResponse } from './types.ts';

export async function fetchConfig(): Promise<Config> {
  const res = await fetch('/api/config');
  return res.json();
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/api/status');
  return res.json();
}

export async function startEnv(envId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/start/${envId}`, { method: 'POST' });
  return res.json();
}

export async function stopEnv(envId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/stop/${envId}`, { method: 'POST' });
  return res.json();
}
