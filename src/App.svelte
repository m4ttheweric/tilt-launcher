<script lang="ts">
  import type { Config, StatusResponse } from './lib/types.ts';
  import { fetchConfig, fetchStatus } from './lib/api.ts';
  import HealthBar from './lib/components/HealthBar.svelte';
  import EnvCard from './lib/components/EnvCard.svelte';
  import LogPanel from './lib/components/LogPanel.svelte';

  let config: Config | null = $state(null);
  let statusData: StatusResponse | null = $state(null);

  async function poll() {
    try {
      statusData = await fetchStatus();
    } catch {
      // server unreachable
    }
  }

  async function init() {
    config = await fetchConfig();
    await poll();
    setInterval(poll, 2000);
  }

  init();
</script>

<div class="min-h-screen bg-bg p-8 text-gray-200">
  <div class="mx-auto max-w-[960px]">
    <!-- Header -->
    <header class="mb-8 text-center">
      <h1 class="mb-1 text-3xl font-bold tracking-tight">Tilt Launcher</h1>
      <p class="text-sm text-text-dim">Manage your Tilt development environments</p>
    </header>

    {#if config}
      <!-- Health bar -->
      <HealthBar environments={config.environments} health={statusData?.health ?? {}} />

      <!-- Environment cards -->
      <div class="mb-5 grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-5">
        {#each config.environments as env (env.id)}
          <EnvCard
            {env}
            status={statusData?.envs[env.id] ?? null}
            health={statusData?.health ?? {}}
            onAction={poll}
          />
        {/each}
      </div>

      <!-- Log panel -->
      <LogPanel environments={config.environments} envStatuses={statusData?.envs ?? {}} />
    {:else}
      <div class="py-20 text-center text-text-muted">Loading...</div>
    {/if}
  </div>
</div>
