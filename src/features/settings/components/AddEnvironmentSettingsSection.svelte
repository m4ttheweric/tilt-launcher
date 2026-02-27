<script lang="ts">
  import type { DiscoverResult } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
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
    onTiltfilePick: (path: string, isSymlink: boolean, realPath?: string) => void;
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

  const resourceCheckboxId = (name: string): string => `new-env-resource-${name.replace(/[^A-Za-z0-9_-]/g, '-')}`;
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
          Discovery succeeded - {discoverResult.resources.length} resource{discoverResult.resources.length === 1
            ? ''
            : 's'} found.
        </Field.Description>
        <div class="max-h-40 space-y-1.5 overflow-auto rounded-md border border-border p-2 text-xs">
          {#each discoverResult.resources as resource (resource.name)}
            <Field.Field orientation="horizontal" class="gap-2">
              <input
                id={resourceCheckboxId(resource.name)}
                type="checkbox"
                checked={selectedDiscovery[resource.name] ?? false}
                onchange={(e) => onDiscoverySelectionChange(resource.name, e.currentTarget.checked)}
              />
              <Field.Content>
                <Field.Label for={resourceCheckboxId(resource.name)}>{resource.name}</Field.Label>
                <Field.Description>
                  {(resource.category ?? 'services') + ' - ' + (resource.port ? `:${resource.port}` : 'no port')}
                </Field.Description>
              </Field.Content>
            </Field.Field>
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
