<script lang="ts">
  import type { DiscoverResult } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
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
    onTiltfilePick: (path: string, isSymlink: boolean, realPath?: string) => void;
    onNewEnvNameChange: (value: string) => void;
    onNewEnvDescriptionChange: (value: string) => void;
    onNewTiltPortChange: (value: number) => void;
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
    onTiltfilePick,
    onNewEnvNameChange,
    onNewEnvDescriptionChange,
    onNewTiltPortChange,
    onRunDiscovery,
    onAddEnvironment,
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
        port: resource.port,
      });
      buckets[category] = existing;
    }
    return Object.entries(buckets).map(([category, resources]) => ({ category, resources }));
  });
</script>

<Field.Set>
  <Field.Label>Add Environment</Field.Label>
  <Field.Description>Pick a Tiltfile, configure metadata, then run discovery.</Field.Description>
  <Field.Group>
    <Field.Field>
      <Field.Label for="new-env-tiltfile">Tiltfile path</Field.Label>
      <Field.Description>Choose the Tiltfile to create a new environment from.</Field.Description>
      <div id="new-env-tiltfile">
        {#key pickerKey}
          <PathAutocomplete onpick={onTiltfilePick} />
        {/key}
      </div>
    </Field.Field>

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

    {#if discovering}
      <div class="space-y-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium">Running Tiltfile discovery…</p>
          <p class="text-[11px] text-muted-foreground tabular-nums">{discoveryElapsed}s / {discoveryMaxSeconds}s</p>
        </div>
        <Progress value={Math.min((discoveryElapsed / discoveryMaxSeconds) * 100, 99)} />
        <p class="text-[11px] text-muted-foreground">Starting Tilt and waiting for resources to appear</p>
      </div>
    {/if}

    {#if discoverResult && !discoverResult.ok}
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

    {#if discoverResult?.ok}
      <Field.Field>
        <Field.Label>Discovery results</Field.Label>
        <Field.Description>
          {discoverResult.resources.length} resource{discoverResult.resources.length === 1 ? '' : 's'} found — all will be
          added.
        </Field.Description>
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
                      <Badge variant={resource.resourceKind === 'serve' ? 'default' : 'secondary'} class="text-[10px]">
                        {resource.resourceKind === 'serve' ? 'serve' : resource.resourceKind === 'cmd' ? 'cmd' : '?'}
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
      </Field.Field>
    {/if}

    <Field.Field orientation="horizontal">
      <Button disabled={discovering} onclick={onRunDiscovery}>
        {discovering ? 'Discovering…' : 'Run Discovery'}
      </Button>
      {#if discoverResult?.ok}
        <Button variant="secondary" onclick={onAddEnvironment}>Add Environment</Button>
      {/if}
    </Field.Field>
  </Field.Group>
</Field.Set>
