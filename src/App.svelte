<script lang="ts">
  import { onMount } from 'svelte';
  import {
    discoverResources,
    fetchLoginItemSettings,
    fetchConfig,
    fetchStatus,
    onStatusUpdated,
    openExternal,
    saveConfig,
    setLoginItemSettings,
    startEnv,
    stopEnv,
  } from './lib/api.ts';
  import type {
    CachedResource,
    Config,
    DiscoverResult,
    Environment,
    ResourceRow,
    StatusResponse,
  } from './lib/types.ts';
  import { formatUptime } from './lib/utils.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import PathAutocomplete from '$lib/components/PathAutocomplete.svelte';
  import X from '@lucide/svelte/icons/x';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Settings from '@lucide/svelte/icons/settings';
  import PaneHeader from '$lib/components/PaneHeader.svelte';

  let config: Config | null = $state(null);
  let draftConfig: Config | null = $state(null);
  let statusData: StatusResponse = $state({ envs: {} });
  let selectedEnvId: string | null = $state(null);
  let activeLogEnvId: string | null = $state(null);
  let selectedTiltUrl = $state('');
  let showSettings = $state(false);
  let message = $state('');
  let messageKind: 'success' | 'error' | '' = $state('');
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
  let discoverResult: DiscoverResult | null = $state(null);
  let selectedDiscovery = $state<Record<string, boolean>>({});
  let discovering = $state(false);
  let discoveryElapsed = $state(0);
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;

  type ConfirmDialog = { open: boolean; title: string; body: string; resolve: ((ok: boolean) => void) | null };
  let confirmDialog: ConfirmDialog = $state({ open: false, title: '', body: '', resolve: null });

  function showConfirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmDialog = { open: true, title, body, resolve };
    });
  }

  function handleConfirmChoice(ok: boolean): void {
    confirmDialog.open = false;
    confirmDialog.resolve?.(ok);
    confirmDialog.resolve = null;
  }
  let leftPanePercent = $state(62);
  let logsHeight = $state(260);
  let rightPaneCollapsed = $state(true);
  let logsCollapsed = $state(false);
  let mediaThemeCleanup: (() => void) | null = null;
  let selectedEnv = $derived(config?.environments.find((env) => env.id === selectedEnvId) ?? null);
  let selectedEnvStatus = $derived(selectedEnv ? (statusData.envs[selectedEnv.id]?.status ?? 'stopped') : 'stopped');

  const statusClasses: Record<string, string> = {
    running: 'bg-emerald-400 text-emerald-950 border-emerald-300',
    starting: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    stopped: 'bg-muted text-muted-foreground border-border',
  };

  function notify(kind: 'success' | 'error', text: string): void {
    messageKind = kind;
    message = text;
    setTimeout(() => {
      if (message === text) {
        message = '';
        messageKind = '';
      }
    }, 3000);
  }

  function cloneConfig(input: Config): Config {
    return JSON.parse(JSON.stringify(input)) as Config;
  }

  function defaultPort(nextConfig: Config): number {
    const inUse = new Set(nextConfig.environments.map((env) => env.tiltPort));
    let candidate = 10350;
    while (inUse.has(candidate)) candidate += 1;
    return candidate;
  }

  function openSettings(): void {
    draftConfig = cloneConfig(config ?? { port: 10400, themeMode: 'system', environments: [] });
    draftConfig.themeMode = draftConfig.themeMode ?? 'system';
    newTiltPort = defaultPort(draftConfig);
    discoverResult = null;
    selectedDiscovery = {};
    newTiltfilePath = '';
    newTiltfileIsSymlink = false;
    pickerKey++;
    newEnvName = '';
    newEnvDescription = '';
    settingsMessage = '';
    settingsMessageKind = '';
    void fetchLoginItemSettings().then((settings) => {
      launchAtLoginDraft = settings.openAtLogin;
    });
    showSettings = true;
  }

  function closeSettings(revertTheme = true): void {
    if (revertTheme && config) {
      applyTheme(config.themeMode ?? 'system');
    }
    if (discoveryTimer) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
    }
    showSettings = false;
  }

  function notifySettings(kind: 'success' | 'error', text: string): void {
    settingsMessageKind = kind;
    settingsMessage = text;
  }

  async function refresh(): Promise<void> {
    statusData = await fetchStatus();
    if (!selectedEnvId && config?.environments.length) {
      selectedEnvId = config.environments[0].id;
      activeLogEnvId = selectedEnvId;
    }
  }

  async function initialize(): Promise<void> {
    try {
      config = await fetchConfig();
      applyTheme(config.themeMode ?? 'system');
      statusData = await fetchStatus();
      if (config.environments.length > 0) {
        selectedEnvId = config.environments[0].id;
        activeLogEnvId = config.environments[0].id;
        selectedTiltUrl = '';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown renderer initialization error';
      notify('error', `Failed to initialize launcher bridge: ${message}`);
    }
  }

  function applyTheme(mode: 'dark' | 'light' | 'system'): void {
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

  function startHorizontalResize(event: MouseEvent): void {
    if (logsCollapsed) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = logsHeight;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientY - startY;
      const next = Math.min(Math.max(startHeight - delta, 160), Math.floor(window.innerHeight * 0.6));
      logsHeight = next;
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startVerticalResize(event: MouseEvent): void {
    if (rightPaneCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = leftPanePercent;
    const onMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientX - startX;
      const next = start + (delta / window.innerWidth) * 100;
      leftPanePercent = Math.min(Math.max(next, 35), 78);
    };
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function healthDotClass(resource: ResourceRow): string {
    if (resource.health === 'up') return 'bg-emerald-400';
    if (resource.health === 'missing') return 'bg-rose-500';
    return 'bg-muted-foreground';
  }

  function openTilt(env: Environment): void {
    selectedEnvId = env.id;
    selectedTiltUrl = `http://localhost:${env.tiltPort}`;
    rightPaneCollapsed = false;
  }

  async function handleStart(env: Environment): Promise<void> {
    const result = await startEnv(env.id);
    if (!result.ok) notify('error', result.error ?? 'Failed to start environment.');
    await refresh();
  }

  async function handleStop(env: Environment): Promise<void> {
    const result = await stopEnv(env.id);
    if (!result.ok) notify('error', result.error ?? 'Failed to stop environment.');
    await refresh();
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
    const confirmed = await showConfirm(
      'Run Tiltfile discovery?',
      `Tilt Launcher will execute this Tiltfile:\n\n${newTiltfilePath}\n\nThis can run shell commands and start resources.`,
    );
    if (!confirmed) return;
    discoverResult = null;
    selectedDiscovery = {};
    discoveryElapsed = 0;
    discovering = true;
    discoveryTimer = setInterval(() => {
      discoveryElapsed += 1;
    }, 1000);
    try {
      discoverResult = await discoverResources({
        tiltfilePath: newTiltfilePath,
        tiltPort: newTiltPort,
        timeoutMs: 30000,
      });
      selectedDiscovery = {};
      for (const resource of discoverResult.resources) {
        const defaultSelected = Boolean(resource.port) && resource.runtimeStatus !== 'not_applicable';
        selectedDiscovery[resource.name] = defaultSelected;
      }
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
    const inUse = new Set(draftConfig.environments.map((env) => env.tiltPort));
    if (inUse.has(newTiltPort)) {
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
    const ids = new Set(draftConfig.environments.map((env) => env.id));
    let id = idBase;
    let idx = 2;
    while (ids.has(id)) id = `${idBase}-${idx++}`;

    const selectedResources = discoverResult.resources
      .filter((resource) => selectedDiscovery[resource.name])
      .map((resource) => resource.name);
    if (selectedResources.length === 0) {
      notify('error', 'Select at least one service/resource to show in the app.');
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
    pickerKey++;
    newEnvName = '';
    newEnvDescription = '';
    newTiltPort = defaultPort(draftConfig);
    discoverResult = null;
    selectedDiscovery = {};
  }

  function removeEnvironment(envId: string): void {
    if (!draftConfig) return;
    draftConfig.environments = draftConfig.environments.filter((env) => env.id !== envId);
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
      timeoutMs: 30000,
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
    const existing = new Set(target.selectedResources ?? []);
    for (const resource of result.resources) {
      if (existing.has(resource.name)) continue;
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
      config = await fetchConfig();
      applyTheme(config.themeMode ?? 'system');
      statusData = await fetchStatus();
      showSettings = false;
      notify('success', 'Settings saved.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown save error';
      notifySettings('error', `Failed to save settings: ${detail}`);
    } finally {
      savingSettings = false;
    }
  }

  onMount(() => {
    void initialize();
    const unlisten = onStatusUpdated((nextStatus) => {
      statusData = nextStatus;
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key === ',';
      if (!isShortcut) return;
      event.preventDefault();
      openSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unlisten();
      mediaThemeCleanup?.();
      window.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
  <header class="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border pr-2 pl-20">
    <div class="no-drag flex items-center gap-2">
      <h1 class="text-sm leading-none font-semibold">Tilt Launcher</h1>
      <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">v{__APP_VERSION__}</span>
    </div>
    <div class="no-drag flex items-center gap-2">
      {#if message}
        <span class={`text-xs ${messageKind === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>{message}</span>
      {/if}
      <button
        type="button"
        class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Open settings"
        onclick={openSettings}
      >
        <Settings class="h-3.5 w-3.5" />
      </button>
    </div>
  </header>

  <div
    class="grid min-h-0 flex-1"
    style={logsCollapsed
      ? 'grid-template-rows: minmax(260px,1fr) 24px'
      : `grid-template-rows: minmax(260px,1fr) 12px ${logsHeight}px`}
  >
    <div
      class="grid min-h-0"
      style={rightPaneCollapsed
        ? 'grid-template-columns: 1fr;'
        : `grid-template-columns: minmax(480px, ${leftPanePercent}%) 12px minmax(360px, ${100 - leftPanePercent}%);`}
    >
      <ScrollArea class={!rightPaneCollapsed ? 'border-r border-border' : ''}>
        <div class="space-y-3 p-3">
          {#if config && config.environments.length > 0}
            {#each config.environments as env (env.id)}
              {@const envStatus = statusData.envs[env.id]}
              <Collapsible.Root open={true} class="overflow-hidden rounded-md border border-border bg-card">
                <Collapsible.Trigger
                  class="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left [&[data-state=open]>.chevron]:rotate-90"
                >
                  <div class="flex min-w-0 flex-1 items-center gap-2">
                    <ChevronRight
                      class="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150"
                    />
                    <h2 class="truncate text-sm font-semibold">{env.name}</h2>
                    {#if env.isSymlink}
                      <span title="Tiltfile is a symlink">
                        <Link2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </span>
                    {/if}
                    <Badge class={`border ${statusClasses[envStatus?.status ?? 'stopped'] ?? statusClasses.stopped}`}>
                      {envStatus?.status ?? 'stopped'}
                    </Badge>
                    {#if (envStatus?.newResources ?? 0) > 0}
                      <Badge variant="secondary">{envStatus?.newResources} new</Badge>
                    {/if}
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onclick={(e) => {
                        e.stopPropagation();
                        openTilt(env);
                      }}>Open Tilt</Button
                    >
                    <Button
                      size="sm"
                      onclick={(e) => {
                        e.stopPropagation();
                        void handleStart(env);
                      }}>Start</Button
                    >
                    <Button
                      size="sm"
                      variant="destructive"
                      onclick={(e) => {
                        e.stopPropagation();
                        void handleStop(env);
                      }}>Stop</Button
                    >
                  </div>
                </Collapsible.Trigger>

                <Collapsible.Content
                  class="overflow-hidden border-t border-border [animation-duration:120ms] [animation-timing-function:cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
                >
                  <div class="space-y-0.5 px-3 py-2">
                    <p class="truncate font-mono text-[11px] text-muted-foreground">{env.repoDir}</p>
                    <p class="truncate text-[11px] text-muted-foreground">
                      {env.tiltfile} ·
                      <button
                        type="button"
                        class="font-mono text-[11px] text-blue-400 underline-offset-2 hover:underline"
                        onclick={() => void openExternal(`http://localhost:${env.tiltPort}`)}
                        >localhost:{env.tiltPort}</button
                      >
                      {#if env.description}· {env.description}{/if}
                    </p>
                    <p class="text-[11px] text-muted-foreground">Uptime: {formatUptime(envStatus?.uptime ?? null)}</p>
                  </div>
                  <div class="divide-y divide-border">
                    {#if envStatus?.resources && envStatus.resources.length > 0}
                      {#each envStatus.resources as resource (resource.key)}
                        <div
                          class="grid grid-cols-[minmax(0,1.4fr)_minmax(58px,0.55fr)_minmax(76px,0.55fr)_minmax(62px,0.45fr)_88px] items-center gap-2 px-3 py-1.5 text-xs"
                        >
                          <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <span class={`inline-block h-2.5 w-2.5 rounded-full ${healthDotClass(resource)}`}></span>
                            <span class="truncate font-medium">{resource.label}</span>
                            <span class="truncate text-[11px] text-muted-foreground">({resource.category})</span>
                          </div>
                          <span class="truncate font-mono text-[11px] text-muted-foreground">
                            {resource.port ? `:${resource.port}` : '—'}
                          </span>
                          <span class="truncate text-[11px] text-muted-foreground capitalize"
                            >{resource.runtimeStatus}</span
                          >
                          <span class="truncate text-[11px] text-muted-foreground uppercase">{resource.health}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!resource.endpoint}
                            onclick={() => {
                              if (!resource.endpoint) return;
                              selectedTiltUrl = resource.endpoint;
                              selectedEnvId = env.id;
                              rightPaneCollapsed = false;
                            }}
                          >
                            Open
                          </Button>
                        </div>
                        {#if resource.error}
                          <p class="px-3 pb-2 text-[11px] text-rose-400">{resource.error}</p>
                        {/if}
                      {/each}
                    {:else}
                      <p class="px-3 py-2 text-xs text-muted-foreground">No selected resources configured.</p>
                    {/if}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            {/each}
          {:else}
            <div class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No environments configured yet. Open Settings to add your first Tiltfile.
            </div>
          {/if}
        </div>
      </ScrollArea>

      {#if !rightPaneCollapsed}
        <button
          type="button"
          class="group relative m-0 cursor-col-resize appearance-none border-0 bg-transparent p-0 outline-none"
          aria-label="Resize main and tilt panes"
          onmousedown={startVerticalResize}
        >
          <span class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70"></span>
          <span
            class="pointer-events-none absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2 bg-primary/20 opacity-0 transition-opacity group-hover:opacity-100"
          ></span>
        </button>
      {/if}

      {#if !rightPaneCollapsed}
        <div class="flex min-h-0 flex-col overflow-hidden bg-background">
          <PaneHeader title={selectedEnv ? `${selectedEnv.name} · ${selectedEnv.tiltfile}` : 'Tilt Dashboard'}>
            {#snippet actions()}
              <button
                type="button"
                class="inline-flex h-5 w-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close embedded tilt pane"
                onclick={() => (rightPaneCollapsed = true)}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            {/snippet}
          </PaneHeader>
          {#if !selectedEnv}
            <div class="grid h-full place-items-center text-xs text-muted-foreground">
              Select an environment to view its embedded Tilt dashboard.
            </div>
          {:else if selectedEnvStatus !== 'running'}
            <div class="grid h-full place-items-center px-6 text-center">
              <div class="max-w-md space-y-3">
                <p class="text-sm font-medium text-foreground">Tilt dashboard unavailable</p>
                <p class="text-xs text-muted-foreground">
                  {selectedEnv.name} is currently <span class="font-semibold capitalize">{selectedEnvStatus}</span>.
                  Start the environment to load its dashboard in this pane.
                </p>
                <div class="flex items-center justify-center gap-2">
                  <Button size="sm" onclick={() => void handleStart(selectedEnv)}>Start {selectedEnv.name}</Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onclick={() => {
                      selectedTiltUrl = `http://localhost:${selectedEnv.tiltPort}`;
                    }}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          {:else if selectedTiltUrl}
            <webview src={selectedTiltUrl} class="h-full w-full overflow-hidden"></webview>
          {:else}
            <div class="grid h-full place-items-center text-xs text-muted-foreground">
              Click a button above to open the Tilt dashboard.
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if !logsCollapsed}
      <button
        type="button"
        class="group relative m-0 cursor-row-resize appearance-none border-0 bg-transparent p-0 outline-none"
        aria-label="Resize logs pane"
        onmousedown={startHorizontalResize}
      >
        <span class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70"></span>
        <span
          class="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 bg-primary/20 opacity-0 transition-opacity group-hover:opacity-100"
        ></span>
      </button>
    {:else}
      <button
        type="button"
        class="flex cursor-pointer items-center justify-between border-t border-border px-2 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        aria-label="Restore logs pane"
        onclick={() => (logsCollapsed = false)}
      >
        <span>Output</span>
        <span>Click to restore</span>
      </button>
    {/if}

    <div class={`flex min-h-0 flex-col overflow-hidden ${logsCollapsed ? 'hidden' : ''}`}>
      <div class="flex h-6 shrink-0 items-stretch border-b border-border bg-muted/50">
        <span class="flex items-center px-2 text-[11px] text-muted-foreground">Output</span>
        {#if config}
          {#each config.environments as env (env.id)}
            <button
              type="button"
              class={`flex items-center border-r border-border px-3 text-[11px] transition-colors ${
                activeLogEnvId === env.id
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onclick={() => (activeLogEnvId = env.id)}
            >
              {env.name}
            </button>
          {/each}
        {/if}
        <div class="ml-auto flex items-center px-1">
          <button
            type="button"
            class="inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Minimize output pane"
            onclick={() => (logsCollapsed = true)}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {#if config}
        {#each config.environments as env (env.id)}
          {#if activeLogEnvId === env.id}
            <ScrollArea class="min-h-0 flex-1 p-2">
              <pre class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{(
                  statusData.envs[env.id]?.logs ?? []
                ).join('\n') || 'No logs yet.'}</pre>
            </ScrollArea>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
</div>

{#if showSettings && draftConfig}
  <div class="fixed inset-x-0 top-10 bottom-0 z-50 bg-black/50">
    <div class="absolute inset-y-0 right-0 flex w-[720px] max-w-[95vw] flex-col border-l border-border bg-background">
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h3 class="text-base font-semibold">Settings</h3>
          <p class="text-xs text-muted-foreground">Tiltfile-driven environment configuration</p>
        </div>
        <Button size="sm" variant="ghost" onclick={() => closeSettings()}>Close</Button>
      </div>

      <ScrollArea class="min-h-0 flex-1">
        <div class="space-y-4 p-3">
          <section class="rounded-md border border-border bg-card p-3">
            <h4 class="mb-2 text-sm font-medium">Appearance</h4>
            <div class="space-y-1">
              <label for="theme-mode" class="text-xs text-muted-foreground">Theme</label>
              <select
                id="theme-mode"
                class="h-8 w-full border border-input bg-background px-2 text-sm"
                value={draftConfig.themeMode ?? 'system'}
                onchange={(e) => {
                  const next = e.currentTarget.value as 'dark' | 'light' | 'system';
                  draftConfig.themeMode = next;
                  applyTheme(next);
                }}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <label class="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={launchAtLoginDraft}
                onchange={(e) => (launchAtLoginDraft = e.currentTarget.checked)}
              />
              <span>Launch at login</span>
            </label>
          </section>

          <section class="rounded-md border border-border bg-card p-3">
            <h4 class="mb-2 text-sm font-medium">Add Environment</h4>
            <div class="space-y-2">
              {#key pickerKey}
                <PathAutocomplete onpick={handleTiltfilePick} />
              {/key}
              <div class="grid grid-cols-2 gap-2">
                <Input
                  value={newEnvName}
                  oninput={(e) => (newEnvName = e.currentTarget.value)}
                  placeholder="Display name"
                />
                <Input
                  type="number"
                  value={String(newTiltPort || '')}
                  oninput={(e) => (newTiltPort = Number(e.currentTarget.value))}
                  placeholder="Tilt port"
                />
              </div>
              <Input
                value={newEnvDescription}
                oninput={(e) => (newEnvDescription = e.currentTarget.value)}
                placeholder="Description (optional)"
              />

              {#if discovering}
                <div class="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-3">
                  <div class="flex items-center justify-between">
                    <p class="text-xs font-medium">Running Tiltfile discovery…</p>
                    <p class="text-[11px] text-muted-foreground tabular-nums">{discoveryElapsed}s / 30s</p>
                  </div>
                  <Progress value={Math.min((discoveryElapsed / 30) * 100, 99)} class="h-1.5" />
                  <p class="text-[11px] text-muted-foreground">Starting Tilt and waiting for resources to appear</p>
                </div>
              {/if}

              {#if discoverResult && !discoverResult.ok}
                <p class="text-xs text-rose-400">{discoverResult.error}</p>
                {#if discoverResult.logs.length > 0}
                  <pre
                    class="max-h-40 overflow-auto rounded-md border border-border bg-muted p-2 text-[11px] text-muted-foreground">{discoverResult.logs.join(
                      '\n',
                    )}</pre>
                {/if}
              {/if}

              {#if discoverResult?.ok}
                <p class="text-xs font-medium text-emerald-400">
                  Discovery succeeded — {discoverResult.resources.length} resource{discoverResult.resources.length === 1
                    ? ''
                    : 's'} found.
                </p>
                <p class="text-xs text-muted-foreground">Select which resources to show in Launchpad:</p>
                <div class="max-h-40 space-y-1 overflow-auto rounded-md border border-border p-2 text-xs">
                  {#each discoverResult.resources as resource (resource.name)}
                    <label class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDiscovery[resource.name] ?? false}
                        onchange={(e) => (selectedDiscovery[resource.name] = e.currentTarget.checked)}
                      />
                      <span>{resource.name}</span>
                      <span class="text-muted-foreground">{resource.category ?? 'services'}</span>
                      <span class="text-muted-foreground">{resource.port ? `:${resource.port}` : 'no port'}</span>
                    </label>
                  {/each}
                </div>
              {/if}
              <div class="flex gap-2">
                <Button disabled={discovering} onclick={runDiscovery}>
                  {discovering ? 'Discovering…' : 'Run Discovery'}
                </Button>
                {#if discoverResult?.ok}
                  <Button variant="secondary" onclick={addDiscoveredEnvironment}>Add Environment</Button>
                {/if}
              </div>
            </div>
          </section>

          <section class="rounded-md border border-border bg-card p-3">
            <h4 class="mb-2 text-sm font-medium">Configured Environments</h4>
            <div class="space-y-3">
              {#each draftConfig.environments as env (env.id)}
                <div class="rounded-md border border-border p-3">
                  <div class="grid grid-cols-[1fr_1fr_120px] gap-2">
                    <Input value={env.name} oninput={(e) => (env.name = e.currentTarget.value)} />
                    <Input value={env.description ?? ''} oninput={(e) => (env.description = e.currentTarget.value)} />
                    <Input
                      type="number"
                      value={String(env.tiltPort)}
                      oninput={(e) => (env.tiltPort = Number(e.currentTarget.value))}
                    />
                  </div>
                  <div class="mt-2 flex items-center gap-1.5">
                    <p class="truncate font-mono text-[11px] text-muted-foreground">{env.repoDir}/{env.tiltfile}</p>
                    {#if env.isSymlink}
                      <span
                        title="Tiltfile is a symlink"
                        class="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 py-px text-[10px] text-muted-foreground"
                      >
                        <Link2 class="h-2.5 w-2.5" />
                        symlink
                      </span>
                    {/if}
                  </div>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onclick={() => rediscover(env)}>Re-discover</Button>
                    <Button size="sm" variant="destructive" onclick={() => removeEnvironment(env.id)}>Remove</Button>
                  </div>
                </div>
              {/each}
              {#if draftConfig.environments.length === 0}
                <p class="text-xs text-muted-foreground">No environments configured yet.</p>
              {/if}
            </div>
          </section>
        </div>
      </ScrollArea>

      <Separator />
      <div class="flex items-center justify-end gap-2 px-3 py-2">
        {#if settingsMessage}
          <p class={`mr-auto text-xs ${settingsMessageKind === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
            {settingsMessage}
          </p>
        {/if}
        <Button variant="secondary" onclick={() => closeSettings()}>Cancel</Button>
        <Button onclick={persistSettings} disabled={savingSettings}>
          {savingSettings ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<Dialog.Root
  open={confirmDialog.open}
  onOpenChange={(open) => {
    if (!open) handleConfirmChoice(false);
  }}
>
  <Dialog.Content showCloseButton={false} class="max-w-sm gap-0 p-0">
    <div class="px-6 pt-6 pb-4">
      <Dialog.Header>
        <Dialog.Title>{confirmDialog.title}</Dialog.Title>
        <Dialog.Description class="text-xs whitespace-pre-wrap">{confirmDialog.body}</Dialog.Description>
      </Dialog.Header>
    </div>
    <Dialog.Footer class="border-t border-border px-6 py-3">
      <Button variant="secondary" onclick={() => handleConfirmChoice(false)}>Cancel</Button>
      <Button onclick={() => handleConfirmChoice(true)}>Continue</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
