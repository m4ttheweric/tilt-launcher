/// <reference types="vite/client" />
/// <reference types="svelte" />

declare global {
  var __APP_VERSION__: string;
  interface Window {
    tiltLauncher: import('./preload/index.ts').TiltLauncherApi;
  }
}

export {};
