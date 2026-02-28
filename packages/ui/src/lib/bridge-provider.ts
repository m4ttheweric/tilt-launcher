import type { LauncherBridge } from '@tilt-launcher/sdk';

let bridge: LauncherBridge | null = null;

/**
 * Register the shell-specific bridge implementation.
 * Must be called before the Svelte app mounts.
 */
export function setBridge(b: LauncherBridge): void {
  bridge = b;
}

/**
 * Retrieve the active bridge. Throws if no shell has registered one yet.
 */
export function getBridge(): LauncherBridge {
  if (!bridge) throw new Error('Bridge not initialized. Shell must call setBridge() before app mount.');
  return bridge;
}
