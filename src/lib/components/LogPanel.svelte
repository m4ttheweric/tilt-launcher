<script lang="ts">
  import type { Environment, EnvStatus } from '../types.ts';

  interface Props {
    environments: Environment[];
    envStatuses: Record<string, EnvStatus>;
  }

  let { environments = [], envStatuses = {} }: Props = $props();

  let activeTab = $state('');
  let autoScroll = $state(true);
  let logEl: HTMLDivElement | undefined = $state();

  let lines = $derived(envStatuses[activeTab]?.logs ?? []);

  $effect(() => {
    // Auto-scroll when new logs come in
    if (autoScroll && logEl && lines.length > 0) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  });

  // Set initial tab and update if environments change
  $effect(() => {
    if (environments.length > 0 && (!activeTab || !environments.find((e) => e.id === activeTab))) {
      activeTab = environments[0].id;
    }
  });

  function handleScroll() {
    if (!logEl) return;
    autoScroll = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30;
  }

  function switchTab(envId: string) {
    activeTab = envId;
  }
</script>

<div class="overflow-hidden rounded-xl border border-border bg-surface">
  <!-- Tabs -->
  <div class="flex flex-wrap border-b border-border">
    {#each environments as env (env.id)}
      <button
        class="min-w-[120px] flex-1 px-4 py-3 text-center text-sm font-semibold transition-all duration-150
               {activeTab === env.id
          ? 'border-b-2 border-indigo-400 text-indigo-400'
          : 'text-text-dim hover:bg-surface-hover hover:text-gray-200'}"
        onclick={() => switchTab(env.id)}
      >
        {env.name} Logs
      </button>
    {/each}
  </div>

  <!-- Log content -->
  <div
    bind:this={logEl}
    onscroll={handleScroll}
    class="h-72 overflow-y-auto p-4 font-mono text-xs leading-relaxed break-all
           whitespace-pre-wrap text-text-dim
           [&::-webkit-scrollbar]:w-1.5
           [&::-webkit-scrollbar-thumb]:rounded-full
           [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
  >
    {#if lines.length === 0}
      <span class="text-text-muted italic">No logs yet. Start an environment to see output.</span>
    {:else}
      {lines.join('\n')}
    {/if}
  </div>
</div>
