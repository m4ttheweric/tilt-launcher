<script lang="ts">
  import type { Config, Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
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

<section class="rounded-md border border-border bg-card p-3">
  <h4 class="mb-2 text-sm font-medium">Configured Environments</h4>
  <div class="space-y-3">
    {#each draftConfig.environments as env (env.id)}
      <div class="rounded-md border border-border p-3">
        <div class="grid grid-cols-[1fr_1fr_120px] gap-2">
          <Input value={env.name} oninput={(e) => onNameChange(env.id, e.currentTarget.value)} />
          <Input value={env.description ?? ''} oninput={(e) => onDescriptionChange(env.id, e.currentTarget.value)} />
          <Input
            type="number"
            value={String(env.tiltPort)}
            oninput={(e) => onTiltPortChange(env.id, Number(e.currentTarget.value))}
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
          <Button size="sm" variant="secondary" onclick={() => void onRediscover(env)}>Re-discover</Button>
          <Button size="sm" variant="outline" onclick={() => onRemove(env.id)}>Remove</Button>
        </div>
      </div>
    {/each}
    {#if draftConfig.environments.length === 0}
      <p class="text-xs text-muted-foreground">No environments configured yet.</p>
    {/if}
  </div>
</section>
