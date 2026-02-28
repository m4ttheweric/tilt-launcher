import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { setBridge } from '$lib/bridge-provider.ts';

// Auto-detect and register the shell bridge.
// Electron: preload sets window.tiltLauncher via contextBridge.
// Tauri: will call setBridge() before loading this entry point.
if ('tiltLauncher' in window) {
  setBridge((window as unknown as Record<string, unknown>).tiltLauncher as import('@tilt-launcher/sdk').LauncherBridge);
}

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');
const app = mount(App, { target });

export default app;
