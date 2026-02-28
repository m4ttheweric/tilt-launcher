<script lang="ts">
  import type { Config, Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
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

{#if draftConfig.environments.length === 0}
  <p class="py-2 text-xs text-muted-foreground">No environments configured yet.</p>
{:else}
  <div class="space-y-2">
    {#each draftConfig.environments as env, i (env.id)}
      {#if i > 0}
        <Separator />
      {/if}
      <div class="space-y-2 py-1">
        <!-- Name -->
        <div class="flex items-center gap-1.5">
          <span class="w-12 shrink-0 text-[11px] text-muted-foreground">Name</span>
          <Input class="h-7 text-xs" value={env.name} oninput={(e) => onNameChange(env.id, e.currentTarget.value)} />
          {#if env.external}
            <Badge variant="secondary" class="shrink-0 text-[9px]">External</Badge>
          {/if}
        </div>

        <!-- Description -->
        <div class="flex items-center gap-1.5">
          <span class="w-12 shrink-0 text-[11px] text-muted-foreground">Desc</span>
          <Input
            class="h-7 text-xs"
            value={env.description ?? ''}
            placeholder="Optional"
            oninput={(e) => onDescriptionChange(env.id, e.currentTarget.value)}
          />
        </div>

        <!-- Port -->
        <div class="flex items-center gap-1.5">
          <span class="w-12 shrink-0 text-[11px] text-muted-foreground">Port</span>
          <Input
            class="h-7 w-24 text-xs"
            type="number"
            value={String(env.tiltPort)}
            oninput={(e) => onTiltPortChange(env.id, Number(e.currentTarget.value))}
          />
        </div>

        <!-- Tiltfile path (read-only) -->
        <div class="mt-5 mb-2 flex items-center gap-2">
          <span class="w-12 shrink-0 text-[11px] text-muted-foreground">Tiltfile</span>
          {#if env.external}
            <p class="min-w-0 truncate text-[11px] text-muted-foreground italic">Port-only (external)</p>
          {:else}
            <p class="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{env.repoDir}/{env.tiltfile}</p>
            {#if env.isSymlink}
              <span
                class="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 py-px text-[9px] text-muted-foreground"
              >
                <Link2 class="h-2.5 w-2.5" />
                symlink
              </span>
            {/if}
          {/if}
        </div>

        <!-- Actions -->
        <div class="mt-5 flex items-center justify-end gap-1.5 pt-0.5">
          {#if !env.external}
            <Button variant="secondary" size="compact-sm" onclick={() => void onRediscover(env)}>Re-discover</Button>
          {/if}
          <Button
            variant="secondary"
            size="compact-sm"
            class="text-destructive hover:text-destructive"
            onclick={() => onRemove(env.id)}
          >
            Remove
          </Button>
        </div>
      </div>
    {/each}
  </div>
{/if}
