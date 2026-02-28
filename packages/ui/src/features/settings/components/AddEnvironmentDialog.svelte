<script lang="ts">
  import type { DiscoverResult } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import PathAutocomplete from '$lib/components/PathAutocomplete.svelte';

  interface Props {
    open: boolean;
    pickerKey: number;
    newEnvName: string;
    newEnvDescription: string;
    newTiltPort: number;
    newEnvExternal: boolean;
    discovering: boolean;
    discoveryElapsed: number;
    discoveryMaxSeconds: number;
    discoverResult: DiscoverResult | null;
    /** Ports already in use by configured environments */
    usedPorts: number[];
    onClose: () => void;
    onTiltfilePick: (path: string, isSymlink: boolean, realPath?: string) => void;
    onNewEnvNameChange: (value: string) => void;
    onNewEnvDescriptionChange: (value: string) => void;
    onNewTiltPortChange: (value: number) => void;
    onNewEnvExternalChange: (value: boolean) => void;
    onRunDiscovery: () => void | Promise<void>;
    onAddEnvironment: () => void;
    onAddExternalEnvironment: () => void;
  }

  let {
    open,
    pickerKey,
    newEnvName,
    newEnvDescription,
    newTiltPort,
    newEnvExternal,
    discovering,
    discoveryElapsed,
    discoveryMaxSeconds,
    discoverResult,
    usedPorts,
    onClose,
    onTiltfilePick,
    onNewEnvNameChange,
    onNewEnvDescriptionChange,
    onNewTiltPortChange,
    onNewEnvExternalChange,
    onRunDiscovery,
    onAddEnvironment,
    onAddExternalEnvironment,
  }: Props = $props();

  interface GroupedResources {
    category: string;
    resources: Array<{ name: string; resourceKind: string; port?: number }>;
  }

  let groupedResources = $derived.by((): GroupedResources[] => {
    if (!discoverResult?.ok) return [];
    const buckets: Record<string, GroupedResources['resources']> = {};
    for (const resource of discoverResult.resources) {
      const category = resource.category ?? 'services';
      const existing = buckets[category] ?? [];
      existing.push({
        name: resource.name,
        resourceKind: resource.resourceKind ?? 'unknown',
        ...(resource.port != null ? { port: resource.port } : {}),
      });
      buckets[category] = existing;
    }
    return Object.entries(buckets).map(([category, resources]) => ({ category, resources }));
  });

  let portConflict = $derived(newTiltPort > 0 && usedPorts.includes(newTiltPort));
  let externalCanAdd = $derived(newEnvExternal && newEnvName.trim().length > 0 && newTiltPort > 0 && !portConflict);
</script>

<Dialog.Root
  {open}
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Dialog.Content class="gap-0 p-0 sm:max-w-[48rem]!">
    <Dialog.Header class="border-b border-border px-4 py-3">
      <Dialog.Title>Add Environment</Dialog.Title>
      <Dialog.Description>
        {#if newEnvExternal}
          Monitor an existing Tilt server by specifying its port.
        {:else}
          Pick a Tiltfile, configure metadata, then run discovery.
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <ScrollArea class="max-h-[70vh]">
      <div class="space-y-4 p-4">
        <!-- Mode toggle -->
        <div class="flex rounded-lg border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              !newEnvExternal
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => onNewEnvExternalChange(false)}
          >
            From Tiltfile
          </button>
          <button
            type="button"
            class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              newEnvExternal ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            onclick={() => onNewEnvExternalChange(true)}
          >
            External (port only)
          </button>
        </div>

        {#if !newEnvExternal}
          <Field.Field>
            <Field.Label for="new-env-tiltfile">Tiltfile path</Field.Label>
            <div id="new-env-tiltfile">
              {#key pickerKey}
                <PathAutocomplete onpick={onTiltfilePick} />
              {/key}
            </div>
          </Field.Field>
        {/if}

        <div class="grid grid-cols-2 gap-3">
          <Field.Field>
            <Field.Label for="new-env-name">Display name</Field.Label>
            <Input
              id="new-env-name"
              value={newEnvName}
              oninput={(e) => onNewEnvNameChange(e.currentTarget.value)}
              placeholder="Display name"
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="new-env-tilt-port">Tilt port</Field.Label>
            <Input
              id="new-env-tilt-port"
              type="number"
              value={String(newTiltPort || '')}
              oninput={(e) => onNewTiltPortChange(Number(e.currentTarget.value))}
              placeholder="Tilt port"
            />
            {#if portConflict}
              <p class="text-xs text-rose-400">Port {newTiltPort} is already in use by another environment.</p>
            {/if}
          </Field.Field>
        </div>

        <Field.Field>
          <Field.Label for="new-env-description">Description</Field.Label>
          <Field.Description>Optional text shown on the Launchpad card.</Field.Description>
          <Input
            id="new-env-description"
            value={newEnvDescription}
            oninput={(e) => onNewEnvDescriptionChange(e.currentTarget.value)}
            placeholder="Description (optional)"
          />
        </Field.Field>

        {#if newEnvExternal}
          <div class="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
            <p class="text-xs text-muted-foreground">
              The app will monitor this port for a running Tilt server and automatically discover its resources. You
              won't be able to start or restart this environment from the app.
            </p>
          </div>
        {/if}

        {#if !newEnvExternal && discovering}
          <div class="space-y-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2">
            <div class="flex items-center justify-between">
              <p class="text-xs font-medium">Running Tiltfile discovery…</p>
              <p class="text-[11px] text-muted-foreground tabular-nums">{discoveryElapsed}s / {discoveryMaxSeconds}s</p>
            </div>
            <Progress value={Math.min((discoveryElapsed / discoveryMaxSeconds) * 100, 99)} />
            <p class="text-[11px] text-muted-foreground">Starting Tilt and waiting for resources to appear</p>
          </div>
        {/if}

        {#if !newEnvExternal && discoverResult && !discoverResult.ok}
          <Field.Field data-invalid={true}>
            <Field.Error>{discoverResult.error}</Field.Error>
            {#if discoverResult.logs.length > 0}
              <pre
                class="max-h-40 overflow-auto rounded-md border border-border bg-muted p-2 text-[11px] text-muted-foreground">{discoverResult.logs.join(
                  '\n',
                )}</pre>
            {/if}
          </Field.Field>
        {/if}

        {#if !newEnvExternal && discoverResult?.ok}
          <div>
            <p class="mb-2 text-xs font-medium">
              {discoverResult.resources.length} resource{discoverResult.resources.length === 1 ? '' : 's'} found — all will
              be added.
            </p>
            <div class="max-h-52 space-y-3 overflow-auto rounded-md border border-border p-2.5 text-xs">
              {#each groupedResources as group (group.category)}
                <div>
                  <p class="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.category}
                  </p>
                  <div class="space-y-1">
                    {#each group.resources as resource (resource.name)}
                      <div class="flex items-center justify-between gap-2 rounded px-1.5 py-1">
                        <span class="truncate font-medium text-foreground">{resource.name}</span>
                        <div class="flex shrink-0 items-center gap-1.5">
                          <Badge
                            variant={resource.resourceKind === 'serve' ? 'default' : 'secondary'}
                            class="text-[10px]"
                          >
                            {resource.resourceKind === 'serve'
                              ? 'serve'
                              : resource.resourceKind === 'cmd'
                                ? 'cmd'
                                : '?'}
                          </Badge>
                          {#if resource.port}
                            <span class="font-mono text-muted-foreground">:{resource.port}</span>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </ScrollArea>

    <Dialog.Footer class="border-t border-border px-4 py-3">
      {#if newEnvExternal}
        <Button
          disabled={!externalCanAdd}
          onclick={() => {
            onAddExternalEnvironment();
            onClose();
          }}
        >
          Add Environment
        </Button>
      {:else}
        <Button disabled={discovering} onclick={() => void onRunDiscovery()}>
          {discovering ? 'Discovering…' : 'Run Discovery'}
        </Button>
        {#if discoverResult?.ok}
          <Button variant="secondary" onclick={onAddEnvironment}>Add Environment</Button>
        {/if}
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
