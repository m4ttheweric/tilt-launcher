<script lang="ts">
  import type { Config, DiscoverResult, Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import AppearanceSettingsSection from './AppearanceSettingsSection.svelte';
  import AddEnvironmentSettingsSection from './AddEnvironmentSettingsSection.svelte';
  import ConfiguredEnvironmentsSettingsSection from './ConfiguredEnvironmentsSettingsSection.svelte';

  interface Props {
    draftConfig: Config;
    launchAtLoginDraft: boolean;
    pickerKey: number;
    newEnvName: string;
    newEnvDescription: string;
    newTiltPort: number;
    discovering: boolean;
    discoveryElapsed: number;
    discoveryMaxSeconds: number;
    discoverResult: DiscoverResult | null;
    selectedDiscovery: Record<string, boolean>;
    settingsMessage: string;
    settingsMessageKind: 'success' | 'error' | '';
    savingSettings: boolean;
    onClose: () => void;
    onThemeModeChange: (mode: 'dark' | 'light' | 'system') => void;
    onLaunchAtLoginChange: (enabled: boolean) => void;
    onTiltfilePick: (path: string, isSymlink: boolean) => void;
    onNewEnvNameChange: (value: string) => void;
    onNewEnvDescriptionChange: (value: string) => void;
    onNewTiltPortChange: (value: number) => void;
    onDiscoverySelectionChange: (resourceName: string, selected: boolean) => void;
    onRunDiscovery: () => void | Promise<void>;
    onAddDiscoveredEnvironment: () => void;
    onDraftEnvNameChange: (envId: string, value: string) => void;
    onDraftEnvDescriptionChange: (envId: string, value: string) => void;
    onDraftEnvTiltPortChange: (envId: string, value: number) => void;
    onRediscover: (env: Environment) => void | Promise<void>;
    onRemoveEnvironment: (envId: string) => void;
    onSave: () => void | Promise<void>;
  }

  let {
    draftConfig,
    launchAtLoginDraft,
    pickerKey,
    newEnvName,
    newEnvDescription,
    newTiltPort,
    discovering,
    discoveryElapsed,
    discoveryMaxSeconds,
    discoverResult,
    selectedDiscovery,
    settingsMessage,
    settingsMessageKind,
    savingSettings,
    onClose,
    onThemeModeChange,
    onLaunchAtLoginChange,
    onTiltfilePick,
    onNewEnvNameChange,
    onNewEnvDescriptionChange,
    onNewTiltPortChange,
    onDiscoverySelectionChange,
    onRunDiscovery,
    onAddDiscoveredEnvironment,
    onDraftEnvNameChange,
    onDraftEnvDescriptionChange,
    onDraftEnvTiltPortChange,
    onRediscover,
    onRemoveEnvironment,
    onSave,
  }: Props = $props();
</script>

<div class="fixed inset-x-0 top-10 bottom-0 z-50 bg-black/50">
  <div class="absolute inset-y-0 right-0 flex w-[720px] max-w-[95vw] flex-col border-l border-border bg-background">
    <div class="flex items-center justify-between border-b border-border px-3 py-2">
      <div>
        <h3 class="text-base font-semibold">Settings</h3>
      </div>
      <Button variant="outline" onclick={onClose}>Close</Button>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="p-3">
        <Field.Group>
          <AppearanceSettingsSection
            themeMode={draftConfig.themeMode ?? 'system'}
            launchAtLogin={launchAtLoginDraft}
            {onThemeModeChange}
            {onLaunchAtLoginChange}
          />
          <Field.Separator />
          <AddEnvironmentSettingsSection
            {pickerKey}
            {newEnvName}
            {newEnvDescription}
            {newTiltPort}
            {discovering}
            {discoveryElapsed}
            {discoveryMaxSeconds}
            {discoverResult}
            {selectedDiscovery}
            {onTiltfilePick}
            {onNewEnvNameChange}
            {onNewEnvDescriptionChange}
            {onNewTiltPortChange}
            {onDiscoverySelectionChange}
            onRunDiscovery={() => void onRunDiscovery()}
            onAddEnvironment={onAddDiscoveredEnvironment}
          />
          <Field.Separator />
          <ConfiguredEnvironmentsSettingsSection
            {draftConfig}
            onNameChange={onDraftEnvNameChange}
            onDescriptionChange={onDraftEnvDescriptionChange}
            onTiltPortChange={onDraftEnvTiltPortChange}
            {onRediscover}
            onRemove={onRemoveEnvironment}
          />
        </Field.Group>
      </div>
    </ScrollArea>

    <Separator />
    <div class="flex items-center justify-end gap-2 px-3 py-2">
      {#if settingsMessage}
        <p class={`mr-auto text-xs ${settingsMessageKind === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
          {settingsMessage}
        </p>
      {/if}
      <Button variant="secondary" onclick={onClose}>Cancel</Button>
      <Button onclick={() => void onSave()} disabled={savingSettings}>
        {savingSettings ? 'Saving…' : 'Save Settings'}
      </Button>
    </div>
  </div>
</div>
