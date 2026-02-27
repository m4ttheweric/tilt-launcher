<script lang="ts">
  import type { Config, Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Field from '$lib/components/ui/field/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import Link2 from '@lucide/svelte/icons/link-2';

  interface Props {
    draftConfig: Config;
    onNameChange: (envId: string, value: string) => void;
    onDescriptionChange: (envId: string, value: string) => void;
    onTiltPortChange: (envId: string, value: number) => void;
    onRediscover: (env: Environment) => void | Promise<void>;
    onRemove: (envId: string) => void;
  }

  let { draftConfig, onNameChange, onDescriptionChange, onTiltPortChange, onRediscover, onRemove }: Props = $props();
</script>

<Field.Set>
  <Field.Label>Configured Environments</Field.Label>
  <Field.Description>Edit existing environment metadata and ports.</Field.Description>
  <Field.Group>
    {#each draftConfig.environments as env (env.id)}
      <Field.Set>
        <Field.Group>
          <div class="grid grid-cols-[1fr_1fr_140px] gap-3">
            <Field.Field>
              <Field.Label for={`env-name-${env.id}`}>Name</Field.Label>
              <Input
                id={`env-name-${env.id}`}
                value={env.name}
                oninput={(e) => onNameChange(env.id, e.currentTarget.value)}
              />
            </Field.Field>
            <Field.Field>
              <Field.Label for={`env-description-${env.id}`}>Description</Field.Label>
              <Input
                id={`env-description-${env.id}`}
                value={env.description ?? ''}
                oninput={(e) => onDescriptionChange(env.id, e.currentTarget.value)}
              />
            </Field.Field>
            <Field.Field>
              <Field.Label for={`env-tilt-port-${env.id}`}>Tilt port</Field.Label>
              <Input
                id={`env-tilt-port-${env.id}`}
                type="number"
                value={String(env.tiltPort)}
                oninput={(e) => onTiltPortChange(env.id, Number(e.currentTarget.value))}
              />
            </Field.Field>
          </div>

          <Field.Field>
            <Field.Label>Tiltfile</Field.Label>
            <div class="flex items-center gap-1.5">
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
          </Field.Field>

          <Field.Field orientation="horizontal">
            <Button variant="secondary" onclick={() => void onRediscover(env)}>Re-discover</Button>
            <Button variant="outline" onclick={() => onRemove(env.id)}>Remove</Button>
          </Field.Field>
        </Field.Group>
      </Field.Set>
    {/each}
    {#if draftConfig.environments.length === 0}
      <Field.Description>No environments configured yet.</Field.Description>
    {/if}
  </Field.Group>
</Field.Set>
