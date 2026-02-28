<script lang="ts">
  import type { Config, DiscoverResult, Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Drawer from '$lib/components/ui/drawer/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import { Plus } from '@lucide/svelte';
  import AppearanceSettingsSection from './AppearanceSettingsSection.svelte';
  import AddEnvironmentDialog from './AddEnvironmentDialog.svelte';
  import ConfiguredEnvironmentsSettingsSection from './ConfiguredEnvironmentsSettingsSection.svelte';

  interface Props {
    open: boolean;
    draftConfig: Config;
    launchAtLoginDraft: boolean;
    pickerKey: number;
    newEnvName: string;
    newEnvDescription: string;
    newTiltPort: number;
    newEnvExternal: boolean;
    discovering: boolean;
    discoveryElapsed: number;
    discoveryMaxSeconds: number;
    discoverResult: DiscoverResult | null;
    settingsMessage: string;
    settingsMessageKind: 'success' | 'error' | '';
    savingSettings: boolean;
    onClose: () => void;
    onThemeModeChange: (mode: 'dark' | 'light' | 'system') => void;
    onLaunchAtLoginChange: (enabled: boolean) => void;
    onTiltfilePick: (path: string, isSymlink: boolean, realPath?: string) => void;
    onNewEnvNameChange: (value: string) => void;
    onNewEnvDescriptionChange: (value: string) => void;
    onNewTiltPortChange: (value: number) => void;
    onNewEnvExternalChange: (value: boolean) => void;
    onRunDiscovery: () => void | Promise<void>;
    onAddDiscoveredEnvironment: () => void;
    onAddExternalEnvironment: () => void;
    onDraftEnvNameChange: (envId: string, value: string) => void;
    onDraftEnvDescriptionChange: (envId: string, value: string) => void;
    onDraftEnvTiltPortChange: (envId: string, value: number) => void;
    onRediscover: (env: Environment) => void | Promise<void>;
    onRemoveEnvironment: (envId: string) => void;
    onSave: () => void | Promise<void>;
  }

  let {
    open,
    draftConfig,
    launchAtLoginDraft,
    pickerKey,
    newEnvName,
    newEnvDescription,
    newTiltPort,
    newEnvExternal,
    discovering,
    discoveryElapsed,
    discoveryMaxSeconds,
    discoverResult,
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
    onNewEnvExternalChange,
    onRunDiscovery,
    onAddDiscoveredEnvironment,
    onAddExternalEnvironment,
    onDraftEnvNameChange,
    onDraftEnvDescriptionChange,
    onDraftEnvTiltPortChange,
    onRediscover,
    onRemoveEnvironment,
    onSave,
  }: Props = $props();

  let addEnvDialogOpen = $state(false);

  let usedPorts = $derived(draftConfig.environments.map((env) => env.tiltPort));
</script>

<Drawer.Root
  direction="right"
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Drawer.Content class="data-[vaul-drawer-direction=right]:sm:max-w-md!">
    <Drawer.Header>
      <Drawer.Title>Settings</Drawer.Title>
      <Drawer.Description>Configure appearance, environments, and preferences.</Drawer.Description>
    </Drawer.Header>

    <ScrollArea class="min-h-0 flex-1 px-4">
      <div class="space-y-4 py-2">
        <AppearanceSettingsSection
          themeMode={draftConfig.themeMode ?? 'system'}
          launchAtLogin={launchAtLoginDraft}
          {onThemeModeChange}
          {onLaunchAtLoginChange}
        />

        <Separator />

        <div class="flex items-center justify-between">
          <div>
            <h4 class="text-sm font-semibold">Environments</h4>
            <p class="text-xs text-muted-foreground">Manage your configured Tiltfile environments.</p>
          </div>
          <Button variant="outline" size="sm" class="h-8 gap-1.5" onclick={() => (addEnvDialogOpen = true)}>
            <Plus class="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        <ConfiguredEnvironmentsSettingsSection
          {draftConfig}
          onNameChange={onDraftEnvNameChange}
          onDescriptionChange={onDraftEnvDescriptionChange}
          onTiltPortChange={onDraftEnvTiltPortChange}
          {onRediscover}
          onRemove={onRemoveEnvironment}
        />
      </div>
    </ScrollArea>

    <Drawer.Footer class="flex-row items-center justify-end gap-2 border-t border-border">
      {#if settingsMessage}
        <p class={`mr-auto text-xs ${settingsMessageKind === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
          {settingsMessage}
        </p>
      {/if}
      <Button variant="secondary" size="sm" onclick={onClose}>Cancel</Button>
      <Button size="sm" onclick={() => void onSave()} disabled={savingSettings}>
        {savingSettings ? 'Saving…' : 'Save'}
      </Button>
    </Drawer.Footer>
  </Drawer.Content>
</Drawer.Root>

<AddEnvironmentDialog
  open={addEnvDialogOpen}
  {pickerKey}
  {newEnvName}
  {newEnvDescription}
  {newTiltPort}
  {newEnvExternal}
  {discovering}
  {discoveryElapsed}
  {discoveryMaxSeconds}
  {discoverResult}
  {usedPorts}
  onClose={() => (addEnvDialogOpen = false)}
  {onTiltfilePick}
  {onNewEnvNameChange}
  {onNewEnvDescriptionChange}
  {onNewTiltPortChange}
  {onNewEnvExternalChange}
  {onRunDiscovery}
  onAddEnvironment={() => {
    onAddDiscoveredEnvironment();
    addEnvDialogOpen = false;
  }}
  onAddExternalEnvironment={() => {
    onAddExternalEnvironment();
    addEnvDialogOpen = false;
  }}
/>
