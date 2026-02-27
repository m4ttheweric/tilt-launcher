<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchConfig, fetchStatus, onStatusUpdated, openExternal, startEnv, stopEnv } from './lib/api.ts';
  import { DISCOVERY_PROGRESS_MAX_SECONDS } from './lib/constants.ts';
  import type { Config, Environment, StatusResponse } from './lib/types.ts';
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
  let statusData: StatusResponse = $state({ envs: {} });
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
    setStatusData: (next) => (statusData = next),
    applyTheme: theme.applyTheme,
    showConfirm: confirm.showConfirm,
    notify,
  });
  const paneResize = usePaneResize(launcher);

  let selectedEnv = $derived(config?.environments.find((env) => env.id === launcher.selectedEnvId) ?? null);
  let selectedEnvStatus = $derived(selectedEnv ? (statusData.envs[selectedEnv.id]?.status ?? 'stopped') : 'stopped');

  async function refresh(): Promise<void> {
    statusData = await fetchStatus();
    if (!launcher.selectedEnvId && config?.environments.length) {
      launcher.selectedEnvId = config.environments[0].id;
      launcher.activeLogEnvId = launcher.selectedEnvId;
    }
  }

  async function initialize(): Promise<void> {
    try {
      config = await fetchConfig();
      theme.applyTheme(config.themeMode ?? 'system');
      statusData = await fetchStatus();
      if (config.environments.length > 0) {
        launcher.selectedEnvId = config.environments[0].id;
        launcher.activeLogEnvId = config.environments[0].id;
        launcher.selectedTiltUrl = '';
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown renderer initialization error';
      notify('error', `Failed to initialize launcher bridge: ${detail}`);
    }
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

  onMount(() => {
    void initialize();
    const unlisten = onStatusUpdated((nextStatus) => {
      statusData = nextStatus;
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key === ',';
      if (!isShortcut) return;
      event.preventDefault();
      settings.openSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unlisten();
      theme.cleanupThemeListener();
      window.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div class="flex h-screen flex-col overflow-hidden bg-background text-foreground">
  <AppHeader
    {message}
    {messageKind}
    themeMode={config?.themeMode ?? 'system'}
    onCycleThemeMode={theme.cycleThemeMode}
    onOpenSettings={settings.openSettings}
  />

  <LauncherWorkspace
    {config}
    {statusData}
    {selectedEnv}
    {selectedEnvStatus}
    {launcher}
    onStart={handleStart}
    onStop={handleStop}
    onOpenExternal={openExternal}
    onStartVerticalResize={paneResize.startVerticalResize}
    onStartHorizontalResize={paneResize.startHorizontalResize}
  />
</div>

{#if settings.showSettings && settings.draftConfig}
  <SettingsDrawer
    draftConfig={settings.draftConfig}
    launchAtLoginDraft={settings.launchAtLoginDraft}
    pickerKey={settings.pickerKey}
    newEnvName={settings.newEnvName}
    newEnvDescription={settings.newEnvDescription}
    newTiltPort={settings.newTiltPort}
    discovering={settings.discovering}
    discoveryElapsed={settings.discoveryElapsed}
    discoveryMaxSeconds={DISCOVERY_PROGRESS_MAX_SECONDS}
    discoverResult={settings.discoverResult}
    selectedDiscovery={settings.selectedDiscovery}
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
    onDiscoverySelectionChange={settings.setDiscoverySelection}
    onRunDiscovery={settings.runDiscovery}
    onAddDiscoveredEnvironment={settings.addDiscoveredEnvironment}
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
