<script lang="ts">
  import { onMount } from 'svelte';
  import {
    disableResource,
    enableResource,
    fetchConfig,
    onConfigUpdated,
    openExternal,
    restartEnv,
    startEnv,
    stopEnv,
    triggerResource,
    saveConfig,
  } from './lib/api.ts';
  import { onBridgeReady } from './lib/bridge-provider.ts';
  import { DISCOVERY_PROGRESS_MAX_SECONDS } from './lib/constants.ts';
  import type { Config, Environment, ServiceMapping } from './lib/types.ts';
  import { useTiltStatus } from './lib/stores/useTiltStatus.svelte.ts';
  import AppHeader from './features/shell/components/AppHeader.svelte';
  import LauncherWorkspace from './features/launcher/components/LauncherWorkspace.svelte';
  import SettingsDrawer from './features/settings/components/SettingsDrawer.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import { useConfirm } from '$lib/hooks/useConfirm.svelte.ts';
  import { useLauncherState } from './features/launcher/useLauncherState.svelte.ts';
  import { usePaneResize } from './features/launcher/usePaneResize.svelte.ts';
  import { useThemeMode } from './features/theme/useThemeMode.svelte.ts';
  import { useSettingsController } from './features/settings/useSettingsController.svelte.ts';

  let config: Config | null = $state(null);
  const tilt = useTiltStatus();
  const launcher = useLauncherState();
  const confirm = useConfirm();

  let message = $state('');
  let messageKind: 'success' | 'error' | '' = $state('');

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

  const theme = useThemeMode({
    getConfig: () => config,
    setConfig: (next) => (config = next),
    notifyError: (text) => notify('error', text),
  });

  const settings = useSettingsController({
    getConfig: () => config,
    setConfig: (next) => (config = next),
    applyTheme: theme.applyTheme,
    showConfirm: confirm.showConfirm,
    notify,
  });
  const paneResize = usePaneResize(launcher);

  let selectedEnv = $derived.by(() => {
    const environments: Environment[] = config?.environments ?? [];
    return environments.find((env) => env.id === launcher.selectedEnvId) ?? null;
  });
  let selectedEnvStatus = $derived(selectedEnv ? (tilt.envs[selectedEnv.id]?.status ?? 'stopped') : 'stopped');

  async function initialize(): Promise<void> {
    try {
      config = await fetchConfig();
      theme.applyTheme(config.themeMode ?? 'system');
      const firstEnv = config.environments[0];
      if (firstEnv) {
        launcher.selectedEnvId = firstEnv.id;
        launcher.activeLogEnvId = firstEnv.id;
        launcher.selectedTiltUrl = '';
      }
    } catch (error) {
      // Bridge not ready yet — this is expected for Tauri (async bridge loading).
      console.debug('initialize deferred:', error);
    }
  }

  async function handleStart(env: Environment): Promise<void> {
    const result = await startEnv(env.id);
    if (!result.ok) notify('error', result.error ?? 'Failed to start environment.');
  }

  async function handleStop(env: Environment): Promise<void> {
    const result = await stopEnv(env.id);
    if (!result.ok) notify('error', result.error ?? 'Failed to stop environment.');
  }

  async function handleRestart(env: Environment): Promise<void> {
    const result = await restartEnv(env.id);
    if (!result.ok) notify('error', result.error ?? 'Failed to restart environment.');
  }

  async function handleTriggerResource(envId: string, resourceName: string): Promise<void> {
    const result = await triggerResource(envId, resourceName);
    if (!result.ok) notify('error', result.error ?? `Failed to trigger ${resourceName}.`);
  }

  async function handleEnableResource(envId: string, resourceName: string): Promise<void> {
    const result = await enableResource(envId, resourceName);
    if (!result.ok) notify('error', result.error ?? `Failed to enable ${resourceName}.`);
  }

  async function handleDisableResource(envId: string, resourceName: string): Promise<void> {
    const result = await disableResource(envId, resourceName);
    if (!result.ok) notify('error', result.error ?? `Failed to disable ${resourceName}.`);
  }

  async function handleSaveMapping(envId: string, mapping: ServiceMapping): Promise<void> {
    if (!config) return;
    const plainMapping = JSON.parse(JSON.stringify(mapping)) as ServiceMapping;
    const updatedConfig: Config = {
      ...$state.snapshot(config),
      environments: $state
        .snapshot(config)
        .environments.map((env) => (env.id === envId ? { ...env, serviceMapping: plainMapping } : env)),
    };
    const result = await saveConfig(updatedConfig);
    if (!result.ok) {
      notify('error', result.error ?? 'Failed to save service mapping.');
      return;
    }
    config = updatedConfig;
    notify('success', 'Service mapping saved.');
  }

  onMount(() => {
    void initialize();
    const unsubscribe = tilt.subscribe();
    const unsubConfig = onConfigUpdated((next) => {
      config = next;
    });

    // Re-initialize when bridge becomes available (Tauri async case).
    onBridgeReady(() => {
      void initialize();
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key === ',';
      if (!isShortcut) return;
      event.preventDefault();
      settings.openSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      unsubConfig();
      theme.cleanupThemeListener();
      window.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background pr-1 pb-1 text-foreground">
  <AppHeader
    {message}
    {messageKind}
    themeMode={config?.themeMode ?? 'system'}
    onCycleThemeMode={theme.cycleThemeMode}
    onOpenSettings={settings.openSettings}
  />

  <LauncherWorkspace
    {config}
    {selectedEnv}
    {selectedEnvStatus}
    {launcher}
    onStart={handleStart}
    onStop={handleStop}
    onRestart={handleRestart}
    onTriggerResource={handleTriggerResource}
    onEnableResource={handleEnableResource}
    onDisableResource={handleDisableResource}
    onOpenExternal={openExternal}
    onSaveMapping={handleSaveMapping}
    onStartVerticalResize={paneResize.startVerticalResize}
    onStartHorizontalResize={paneResize.startHorizontalResize}
  />
</div>

{#if settings.draftConfig}
  <SettingsDrawer
    open={settings.showSettings}
    draftConfig={settings.draftConfig}
    launchAtLoginDraft={settings.launchAtLoginDraft}
    pickerKey={settings.pickerKey}
    newEnvName={settings.newEnvName}
    newEnvDescription={settings.newEnvDescription}
    newTiltPort={settings.newTiltPort}
    newEnvExternal={settings.newEnvExternal}
    discovering={settings.discovering}
    discoveryElapsed={settings.discoveryElapsed}
    discoveryMaxSeconds={DISCOVERY_PROGRESS_MAX_SECONDS}
    discoverResult={settings.discoverResult}
    settingsMessage={settings.settingsMessage}
    settingsMessageKind={settings.settingsMessageKind}
    savingSettings={settings.savingSettings}
    onClose={() => settings.closeSettings()}
    onThemeModeChange={settings.setThemeMode}
    onLaunchAtLoginChange={(enabled) => (settings.launchAtLoginDraft = enabled)}
    onTiltfilePick={settings.handleTiltfilePick}
    onNewEnvNameChange={(value) => (settings.newEnvName = value)}
    onNewEnvDescriptionChange={(value) => (settings.newEnvDescription = value)}
    onNewTiltPortChange={(value) => (settings.newTiltPort = value)}
    onNewEnvExternalChange={(value) => (settings.newEnvExternal = value)}
    onRunDiscovery={settings.runDiscovery}
    onAddDiscoveredEnvironment={settings.addDiscoveredEnvironment}
    onAddExternalEnvironment={settings.addExternalEnvironment}
    onDraftEnvNameChange={(envId, value) => settings.updateDraftEnvironment(envId, { name: value })}
    onDraftEnvDescriptionChange={(envId, value) => settings.updateDraftEnvironment(envId, { description: value })}
    onDraftEnvTiltPortChange={(envId, value) => settings.updateDraftEnvironment(envId, { tiltPort: value })}
    onRediscover={settings.rediscover}
    onRemoveEnvironment={settings.removeEnvironment}
    onSave={settings.persistSettings}
  />
{/if}

<ConfirmDialog
  open={confirm.confirmDialog.open}
  title={confirm.confirmDialog.title}
  body={confirm.confirmDialog.body}
  onCancel={() => confirm.handleConfirmChoice(false)}
  onConfirm={() => confirm.handleConfirmChoice(true)}
/>
