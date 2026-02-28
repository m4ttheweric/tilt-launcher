import { saveConfig } from '$lib/api.ts';
import type { Config } from '$lib/types.ts';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeModeOptions {
  getConfig: () => Config | null;
  setConfig: (next: Config) => void;
  notifyError: (text: string) => void;
}

function cloneConfig(input: Config): Config {
  return JSON.parse(JSON.stringify(input)) as Config;
}

export function useThemeMode({ getConfig, setConfig, notifyError }: ThemeModeOptions) {
  let mediaThemeCleanup: (() => void) | null = null;

  function applyTheme(mode: ThemeMode): void {
    mediaThemeCleanup?.();
    mediaThemeCleanup = null;
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add('dark');
      return;
    }
    if (mode === 'light') {
      root.classList.remove('dark');
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      root.classList.toggle('dark', media.matches);
    };
    apply();
    const onChange = (): void => apply();
    media.addEventListener('change', onChange);
    mediaThemeCleanup = (): void => media.removeEventListener('change', onChange);
  }

  function nextThemeMode(current: ThemeMode): ThemeMode {
    if (current === 'light') return 'dark';
    if (current === 'dark') return 'system';
    return 'light';
  }

  async function cycleThemeMode(): Promise<void> {
    const current = getConfig();
    if (!current) return;
    const previous = current.themeMode ?? 'system';
    const next = nextThemeMode(previous);
    const optimistic = { ...current, themeMode: next };
    setConfig(optimistic);
    applyTheme(next);
    const result = await saveConfig(cloneConfig(optimistic));
    if (result.ok) return;

    const reverted = { ...optimistic, themeMode: previous };
    setConfig(reverted);
    applyTheme(previous);
    notifyError(result.error ?? 'Failed to update theme.');
  }

  function cleanupThemeListener(): void {
    mediaThemeCleanup?.();
    mediaThemeCleanup = null;
  }

  return {
    applyTheme,
    cycleThemeMode,
    cleanupThemeListener,
  };
}
