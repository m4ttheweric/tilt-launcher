<script lang="ts">
  import type { DiscoverResult } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import PathAutocomplete from '$lib/components/PathAutocomplete.svelte';

  interface Props {
    pickerKey: number;
    newEnvName: string;
    newEnvDescription: string;
    newTiltPort: number;
    discovering: boolean;
    discoveryElapsed: number;
    discoveryMaxSeconds: number;
    discoverResult: DiscoverResult | null;
    selectedDiscovery: Record<string, boolean>;
    onTiltfilePick: (path: string, isSymlink: boolean) => void;
    onNewEnvNameChange: (value: string) => void;
    onNewEnvDescriptionChange: (value: string) => void;
    onNewTiltPortChange: (value: number) => void;
    onDiscoverySelectionChange: (resourceName: string, selected: boolean) => void;
    onRunDiscovery: () => void | Promise<void>;
    onAddEnvironment: () => void;
  }

  let {
    pickerKey,
    newEnvName,
    newEnvDescription,
    newTiltPort,
    discovering,
    discoveryElapsed,
    discoveryMaxSeconds,
    discoverResult,
    selectedDiscovery,
    onTiltfilePick,
    onNewEnvNameChange,
    onNewEnvDescriptionChange,
    onNewTiltPortChange,
    onDiscoverySelectionChange,
    onRunDiscovery,
    onAddEnvironment,
  }: Props = $props();
</script>

<section class="rounded-md border border-border bg-card p-3">
  <h4 class="mb-2 text-sm font-medium">Add Environment</h4>
  <div class="space-y-2">
    {#key pickerKey}
      <PathAutocomplete onpick={onTiltfilePick} />
    {/key}
    <div class="grid grid-cols-2 gap-2">
      <Input value={newEnvName} oninput={(e) => onNewEnvNameChange(e.currentTarget.value)} placeholder="Display name" />
      <Input
        type="number"
        value={String(newTiltPort || '')}
        oninput={(e) => onNewTiltPortChange(Number(e.currentTarget.value))}
        placeholder="Tilt port"
      />
    </div>
    <Input
      value={newEnvDescription}
      oninput={(e) => onNewEnvDescriptionChange(e.currentTarget.value)}
      placeholder="Description (optional)"
    />

    {#if discovering}
      <div class="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-3">
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium">Running Tiltfile discovery…</p>
          <p class="text-[11px] text-muted-foreground tabular-nums">{discoveryElapsed}s / {discoveryMaxSeconds}s</p>
        </div>
        <Progress value={Math.min((discoveryElapsed / discoveryMaxSeconds) * 100, 99)} class="h-1.5" />
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
              onchange={(e) => onDiscoverySelectionChange(resource.name, e.currentTarget.checked)}
            />
            <span>{resource.name}</span>
            <span class="text-muted-foreground">{resource.category ?? 'services'}</span>
            <span class="text-muted-foreground">{resource.port ? `:${resource.port}` : 'no port'}</span>
          </label>
        {/each}
      </div>
    {/if}
    <div class="flex gap-2">
      <Button disabled={discovering} onclick={onRunDiscovery}>
        {discovering ? 'Discovering…' : 'Run Discovery'}
      </Button>
      {#if discoverResult?.ok}
        <Button variant="secondary" onclick={onAddEnvironment}>Add Environment</Button>
      {/if}
    </div>
  </div>
</section>
