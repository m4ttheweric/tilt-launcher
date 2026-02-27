<script lang="ts">
  import type { Config, StatusResponse } from '$lib/types.ts';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import SplitterHandle from '$lib/components/SplitterHandle.svelte';
  import X from '@lucide/svelte/icons/x';

  interface Props {
    config: Config | null;
    statusData: StatusResponse;
    activeLogEnvId: string | null;
    logsCollapsed: boolean;
    onStartResize: (event: MouseEvent) => void;
    onRestore: () => void;
    onCollapse: () => void;
    onSelectEnv: (envId: string) => void;
  }

  let { config, statusData, activeLogEnvId, logsCollapsed, onStartResize, onRestore, onCollapse, onSelectEnv }: Props =
    $props();
</script>

{#if !logsCollapsed}
  <SplitterHandle orientation="horizontal" ariaLabel="Resize logs pane" onResizeStart={onStartResize} />
{:else}
  <button
    type="button"
    class="flex cursor-pointer items-center justify-between border-t border-border px-2 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
    aria-label="Restore logs pane"
    onclick={onRestore}
  >
    <span>Output</span>
    <span>Click to restore</span>
  </button>
{/if}

<div class={`flex min-h-0 flex-col overflow-hidden ${logsCollapsed ? 'hidden' : ''}`}>
  <div class="flex h-6 shrink-0 items-stretch border-b border-border bg-muted/50">
    <span class="flex items-center px-2 text-[11px] text-muted-foreground">Output</span>
    {#if config}
      {#each config.environments as env (env.id)}
        <button
          type="button"
          class={`flex items-center border-r border-border px-3 text-[11px] transition-colors ${
            activeLogEnvId === env.id
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
          onclick={() => onSelectEnv(env.id)}
        >
          {env.name}
        </button>
      {/each}
    {/if}
    <div class="ml-auto flex items-center px-1">
      <button
        type="button"
        class="inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Minimize output pane"
        onclick={onCollapse}
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
  {#if config}
    {#each config.environments as env (env.id)}
      {#if activeLogEnvId === env.id}
        <ScrollArea class="min-h-0 flex-1 p-2">
          <pre class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{(
              statusData.envs[env.id]?.logs ?? []
            ).join('\n') || 'No logs yet.'}</pre>
        </ScrollArea>
      {/if}
    {/each}
  {/if}
</div>
