import {
  LEFT_PANE_MAX_PERCENT,
  LEFT_PANE_MIN_PERCENT,
  LOGS_MAX_HEIGHT_RATIO,
  LOGS_MIN_HEIGHT_PX,
} from '$lib/constants.ts';
import type { LauncherState } from './useLauncherState.svelte.ts';

export function usePaneResize(launcher: LauncherState) {
  function startHorizontalResize(event: MouseEvent): void {
    if (launcher.logsCollapsed) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = launcher.logsHeight;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientY - startY;
      const next = Math.min(
        Math.max(startHeight - delta, LOGS_MIN_HEIGHT_PX),
        Math.floor(window.innerHeight * LOGS_MAX_HEIGHT_RATIO),
      );
      launcher.logsHeight = next;
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startVerticalResize(event: MouseEvent): void {
    if (launcher.rightPaneCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = launcher.leftPanePercent;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = start + (delta / window.innerWidth) * 100;
      launcher.leftPanePercent = Math.min(Math.max(next, LEFT_PANE_MIN_PERCENT), LEFT_PANE_MAX_PERCENT);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return {
    startHorizontalResize,
    startVerticalResize,
  };
}
