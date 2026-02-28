import { discoverResources, fetchConfig, fetchLoginItemSettings, saveConfig, setLoginItemSettings } from '$lib/api.ts';
import { DEFAULT_CONFIG_PORT, DEFAULT_TILT_PORT_START, DISCOVERY_TIMEOUT_MS } from '$lib/constants.ts';
import type { CachedResource, Config, DiscoverResult, Environment } from '$lib/types.ts';

interface SettingsControllerOptions {
  getConfig: () => Config | null;
  setConfig: (next: Config) => void;
  applyTheme: (mode: 'dark' | 'light' | 'system') => void;
  showConfirm: (title: string, body: string) => Promise<boolean>;
  notify: (kind: 'success' | 'error', text: string) => void;
}

function cloneConfig(input: Config): Config {
  return JSON.parse(JSON.stringify(input)) as Config;
}

function defaultPort(nextConfig: Config): number {
  const inUse = new Set(nextConfig.environments.map((env) => env.tiltPort));
  let candidate = DEFAULT_TILT_PORT_START;
  while (inUse.has(candidate)) candidate += 1;
  return candidate;
}

export function useSettingsController({
  getConfig,
  setConfig,
  applyTheme,
  showConfirm,
  notify,
}: SettingsControllerOptions) {
  let draftConfig: Config | null = $state(null);
  let showSettings = $state(false);
  let settingsMessage = $state('');
  let settingsMessageKind: 'success' | 'error' | '' = $state('');
  let savingSettings = $state(false);
  let launchAtLoginDraft = $state(false);
  let newTiltfilePath = $state('');
  let newTiltfileIsSymlink = $state(false);
  let pickerKey = $state(0);
  let newEnvName = $state('');
  let newEnvDescription = $state('');
  let newTiltPort = $state(0);
  let newEnvExternal = $state(false);
  let discoverResult: DiscoverResult | null = $state(null);
  let discovering = $state(false);
  let discoveryElapsed = $state(0);
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;

  function notifySettings(kind: 'success' | 'error', text: string): void {
    settingsMessageKind = kind;
    settingsMessage = text;
  }

  function openSettings(): void {
    const current = getConfig();
    draftConfig = cloneConfig(current ?? { port: DEFAULT_CONFIG_PORT, themeMode: 'system', environments: [] });
    draftConfig.themeMode = draftConfig.themeMode ?? 'system';
    newTiltPort = defaultPort(draftConfig);
    discoverResult = null;
    newTiltfilePath = '';
    newTiltfileIsSymlink = false;
    pickerKey += 1;
    newEnvName = '';
    newEnvDescription = '';
    newEnvExternal = false;
    settingsMessage = '';
    settingsMessageKind = '';
    void fetchLoginItemSettings().then((settings) => {
      launchAtLoginDraft = settings.openAtLogin;
    });
    showSettings = true;
  }

  function closeSettings(revertTheme = true): void {
    const current = getConfig();
    if (revertTheme && current) {
      applyTheme(current.themeMode ?? 'system');
    }
    if (discoveryTimer) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
    }
    showSettings = false;
  }

  function handleTiltfilePick(path: string, isSymlink: boolean): void {
    newTiltfilePath = path;
    newTiltfileIsSymlink = isSymlink;
    const file = path.split('/').at(-1) ?? 'Tiltfile';
    if (!newEnvName) newEnvName = file.replace(/^Tiltfile\.?/, '') || file;
  }

  async function runDiscovery(): Promise<void> {
    if (!newTiltfilePath || !newTiltPort) {
      notifySettings('error', 'Select a Tiltfile and port before discovery.');
      return;
    }
    discoverResult = null;
    discoveryElapsed = 0;
    discovering = true;
    discoveryTimer = setInterval(() => {
      discoveryElapsed += 1;
    }, 1000);
    try {
      discoverResult = await discoverResources({
        tiltfilePath: newTiltfilePath,
        tiltPort: newTiltPort,
        timeoutMs: DISCOVERY_TIMEOUT_MS,
      });
    } finally {
      discovering = false;
      if (discoveryTimer) {
        clearInterval(discoveryTimer);
        discoveryTimer = null;
      }
    }
  }

  function addDiscoveredEnvironment(): void {
    if (!draftConfig || !discoverResult?.ok) return;
    if (!newEnvName.trim()) {
      notify('error', 'Enter a display name for the environment.');
      return;
    }
    const inUse: Record<number, true> = {};
    for (const env of draftConfig.environments) inUse[env.tiltPort] = true;
    if (inUse[newTiltPort]) {
      notify('error', `Tilt port ${newTiltPort} is already in use.`);
      return;
    }

    const normalizedName = newEnvName.trim();
    const repoDir = newTiltfilePath.split('/').slice(0, -1).join('/');
    const tiltfile = newTiltfilePath.split('/').at(-1) ?? 'Tiltfile';
    const idBase =
      normalizedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'env';
    const ids: Record<string, true> = {};
    for (const env of draftConfig.environments) ids[env.id] = true;
    let id = idBase;
    let idx = 2;
    while (ids[id]) id = `${idBase}-${idx++}`;

    const selectedResources = discoverResult.resources.map((resource) => resource.name);
    if (selectedResources.length === 0) {
      notify('error', 'No resources found to add.');
      return;
    }

    draftConfig.environments = [
      ...draftConfig.environments,
      {
        id,
        name: normalizedName,
        repoDir,
        tiltfile,
        tiltPort: newTiltPort,
        description: newEnvDescription.trim(),
        isSymlink: newTiltfileIsSymlink,
        selectedResources,
        cachedResources: discoverResult.resources as CachedResource[],
      },
    ];

    newTiltfilePath = '';
    newTiltfileIsSymlink = false;
    pickerKey += 1;
    newEnvName = '';
    newEnvDescription = '';
    newEnvExternal = false;
    newTiltPort = defaultPort(draftConfig);
    discoverResult = null;
  }

  /** Adds a port-only external environment (no Tiltfile, no discovery). */
  function addExternalEnvironment(): void {
    if (!draftConfig) return;
    if (!newEnvName.trim()) {
      notify('error', 'Enter a display name for the environment.');
      return;
    }
    if (!newTiltPort || newTiltPort <= 0) {
      notify('error', 'Enter a valid Tilt port.');
      return;
    }
    const inUse: Record<number, true> = {};
    for (const env of draftConfig.environments) inUse[env.tiltPort] = true;
    if (inUse[newTiltPort]) {
      notify('error', `Tilt port ${newTiltPort} is already in use by another environment.`);
      return;
    }

    const normalizedName = newEnvName.trim();
    const idBase =
      normalizedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'env';
    const ids: Record<string, true> = {};
    for (const env of draftConfig.environments) ids[env.id] = true;
    let id = idBase;
    let idx = 2;
    while (ids[id]) id = `${idBase}-${idx++}`;

    draftConfig.environments = [
      ...draftConfig.environments,
      {
        id,
        name: normalizedName,
        external: true,
        repoDir: '',
        tiltfile: '',
        tiltPort: newTiltPort,
        description: newEnvDescription.trim(),
        selectedResources: [],
        cachedResources: [],
      },
    ];

    newEnvName = '';
    newEnvDescription = '';
    newEnvExternal = false;
    newTiltPort = defaultPort(draftConfig);
  }

  function removeEnvironment(envId: string): void {
    if (!draftConfig) return;
    draftConfig.environments = draftConfig.environments.filter((env) => env.id !== envId);
  }

  function updateDraftEnvironment(envId: string, updates: Partial<Environment>): void {
    if (!draftConfig) return;
    draftConfig.environments = draftConfig.environments.map((env) =>
      env.id === envId
        ? {
            ...env,
            ...updates,
          }
        : env,
    );
  }

  async function rediscover(env: Environment): Promise<void> {
    if (!draftConfig) return;
    const fullPath = `${env.repoDir}/${env.tiltfile}`;
    const confirmed = await showConfirm(
      'Re-discover resources?',
      `Tilt Launcher will re-execute this Tiltfile:\n\n${fullPath}\n\nThis can run shell commands and start resources.`,
    );
    if (!confirmed) return;
    discovering = true;
    const result = await discoverResources({
      tiltfilePath: fullPath,
      tiltPort: env.tiltPort,
      timeoutMs: DISCOVERY_TIMEOUT_MS,
    });
    discovering = false;
    if (!result.ok) {
      notify('error', result.error ?? 'Discovery failed.');
      discoverResult = result;
      return;
    }
    const target = draftConfig.environments.find((item) => item.id === env.id);
    if (!target) return;
    target.cachedResources = result.resources;
    const existing: Record<string, true> = {};
    for (const resourceName of target.selectedResources ?? []) existing[resourceName] = true;
    for (const resource of result.resources) {
      if (existing[resource.name]) continue;
      if (resource.port && resource.runtimeStatus !== 'not_applicable') {
        target.selectedResources = [...(target.selectedResources ?? []), resource.name];
      }
    }
    notify('success', `Re-discovered resources for ${env.name}.`);
  }

  async function persistSettings(): Promise<void> {
    if (!draftConfig) return;
    savingSettings = true;
    settingsMessage = '';
    settingsMessageKind = '';
    try {
      const used: Record<number, true> = {};
      for (const env of draftConfig.environments) {
        if (used[env.tiltPort]) {
          notifySettings('error', `Port conflict detected for ${env.name} (${env.tiltPort}).`);
          return;
        }
        used[env.tiltPort] = true;
      }
      const result = await saveConfig(cloneConfig(draftConfig));
      if (!result.ok) {
        notifySettings('error', result.error ?? 'Failed to save settings.');
        return;
      }
      const loginItemResult = await setLoginItemSettings(launchAtLoginDraft);
      if (!loginItemResult.ok) {
        notifySettings('error', loginItemResult.error ?? 'Failed to update launch-at-login.');
        return;
      }
      const nextConfig = await fetchConfig();
      setConfig(nextConfig);
      applyTheme(nextConfig.themeMode ?? 'system');
      showSettings = false;
      notify('success', 'Settings saved.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown save error';
      notifySettings('error', `Failed to save settings: ${detail}`);
    } finally {
      savingSettings = false;
    }
  }

  return {
    get showSettings(): boolean {
      return showSettings;
    },
    get draftConfig(): Config | null {
      return draftConfig;
    },
    get settingsMessage(): string {
      return settingsMessage;
    },
    get settingsMessageKind(): 'success' | 'error' | '' {
      return settingsMessageKind;
    },
    get savingSettings(): boolean {
      return savingSettings;
    },
    get launchAtLoginDraft(): boolean {
      return launchAtLoginDraft;
    },
    set launchAtLoginDraft(value: boolean) {
      launchAtLoginDraft = value;
    },
    get pickerKey(): number {
      return pickerKey;
    },
    get newEnvName(): string {
      return newEnvName;
    },
    set newEnvName(value: string) {
      newEnvName = value;
    },
    get newEnvDescription(): string {
      return newEnvDescription;
    },
    set newEnvDescription(value: string) {
      newEnvDescription = value;
    },
    get newTiltPort(): number {
      return newTiltPort;
    },
    set newTiltPort(value: number) {
      newTiltPort = value;
    },
    get newEnvExternal(): boolean {
      return newEnvExternal;
    },
    set newEnvExternal(value: boolean) {
      newEnvExternal = value;
    },
    get discoverResult(): DiscoverResult | null {
      return discoverResult;
    },
    get discovering(): boolean {
      return discovering;
    },
    get discoveryElapsed(): number {
      return discoveryElapsed;
    },
    setThemeMode(mode: 'dark' | 'light' | 'system'): void {
      if (!draftConfig) return;
      draftConfig.themeMode = mode;
      applyTheme(mode);
    },
    openSettings,
    closeSettings,
    handleTiltfilePick,
    runDiscovery,
    addDiscoveredEnvironment,
    addExternalEnvironment,
    removeEnvironment,
    updateDraftEnvironment,
    rediscover,
    persistSettings,
  };
}
