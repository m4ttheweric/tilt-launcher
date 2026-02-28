import type { Environment } from '$lib/types.ts';

type TiltWebview = HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> };

export function useLauncherState() {
  let selectedEnvId: string | null = $state(null);
  let activeLogEnvId: string | null = $state(null);
  let selectedTiltUrl = $state('');
  let leftPanePercent = $state(62);
  let logsHeight = $state(260);
  let rightPaneCollapsed = $state(true);
  let logsCollapsed = $state(false);
  let tiltWebview: TiltWebview | null = $state(null);
  let tiltZoomFactor = $state(1);

  function openTilt(env: Environment): void {
    selectedEnvId = env.id;
    selectedTiltUrl = `http://localhost:${env.tiltPort}`;
    rightPaneCollapsed = false;
  }

  async function applyTiltZoom(next: number): Promise<void> {
    if (!tiltWebview?.executeJavaScript) return;
    const clamped = Math.min(Math.max(next, 0.5), 2.5);
    await tiltWebview.executeJavaScript(`document.documentElement.style.zoom = '${clamped}'`);
    tiltZoomFactor = clamped;
  }

  async function zoomTilt(delta: number): Promise<void> {
    await applyTiltZoom(tiltZoomFactor + delta);
  }

  async function resetTiltZoom(): Promise<void> {
    await applyTiltZoom(1);
  }

  return {
    get selectedEnvId(): string | null {
      return selectedEnvId;
    },
    set selectedEnvId(value: string | null) {
      selectedEnvId = value;
    },
    get activeLogEnvId(): string | null {
      return activeLogEnvId;
    },
    set activeLogEnvId(value: string | null) {
      activeLogEnvId = value;
    },
    get selectedTiltUrl(): string {
      return selectedTiltUrl;
    },
    set selectedTiltUrl(value: string) {
      selectedTiltUrl = value;
    },
    get leftPanePercent(): number {
      return leftPanePercent;
    },
    set leftPanePercent(value: number) {
      leftPanePercent = value;
    },
    get logsHeight(): number {
      return logsHeight;
    },
    set logsHeight(value: number) {
      logsHeight = value;
    },
    get rightPaneCollapsed(): boolean {
      return rightPaneCollapsed;
    },
    set rightPaneCollapsed(value: boolean) {
      rightPaneCollapsed = value;
    },
    get logsCollapsed(): boolean {
      return logsCollapsed;
    },
    set logsCollapsed(value: boolean) {
      logsCollapsed = value;
    },
    get tiltWebview(): TiltWebview | null {
      return tiltWebview;
    },
    set tiltWebview(value: TiltWebview | null) {
      tiltWebview = value;
    },
    get tiltZoomFactor(): number {
      return tiltZoomFactor;
    },
    set tiltZoomFactor(value: number) {
      tiltZoomFactor = value;
    },
    openTilt,
    applyTiltZoom,
    zoomTilt,
    resetTiltZoom,
  };
}

export type LauncherState = ReturnType<typeof useLauncherState>;
