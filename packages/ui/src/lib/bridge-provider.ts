import type { LauncherBridge } from '@tilt-launcher/sdk';

let bridge: LauncherBridge | null = null;
const onReadyCallbacks: Array<(b: LauncherBridge) => void> = [];

/**
 * Register the shell-specific bridge implementation.
 */
export function setBridge(b: LauncherBridge): void {
  bridge = b;
  for (const cb of onReadyCallbacks) cb(b);
  onReadyCallbacks.length = 0;
}

/**
 * Retrieve the active bridge. Returns null if no shell has registered one.
 */
export function getBridge(): LauncherBridge | null {
  return bridge;
}

/**
 * Register a callback for when the bridge becomes available.
 * If already available, fires immediately.
 */
export function onBridgeReady(cb: (b: LauncherBridge) => void): void {
  if (bridge) {
    cb(bridge);
  } else {
    onReadyCallbacks.push(cb);
  }
}
