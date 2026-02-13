<script lang="ts">
  import type { Environment, EnvStatus, HealthStatus } from '../types.ts';
  import { startEnv, stopEnv } from '../api.ts';
  import { formatUptime } from '../utils.ts';

  interface Props {
    env: Environment;
    status: EnvStatus | null;
    health: Record<string, HealthStatus>;
    onAction: () => void;
  }

  let { env, status = null, health = {}, onAction }: Props = $props();

  let envStatus = $derived(status?.status ?? 'stopped');
  let isRunning = $derived(envStatus === 'running');
  let isStarting = $derived(envStatus === 'starting');
  let isActive = $derived(isRunning || isStarting);

  let borderClass = $derived(
    isRunning ? 'border-green-500/25' : isStarting ? 'border-yellow-500/25' : 'border-border',
  );

  let pillClass = $derived(
    isRunning
      ? 'bg-green-500/10 text-green-500 border border-green-500/25'
      : isStarting
        ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/25'
        : 'bg-surface-hover text-text-muted',
  );

  let pillLabel = $derived(isRunning ? 'Running' : isStarting ? 'Starting...' : 'Stopped');

  async function handleStart() {
    await startEnv(env.id);
    onAction();
  }

  async function handleStop() {
    await stopEnv(env.id);
    onAction();
  }
</script>

<div
  class="border bg-surface {borderClass} flex flex-col gap-4 rounded-xl p-6 transition-all duration-250"
>
  <!-- Header -->
  <div class="flex items-center justify-between">
    <span class="text-lg font-semibold">{env.name}</span>
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase {pillClass}"
    >
      <span class="h-[7px] w-[7px] rounded-full bg-current" class:animate-pulse={isActive}></span>
      {pillLabel}
    </span>
  </div>

  <!-- Uptime -->
  {#if isRunning && status?.uptime}
    <span class="text-xs text-text-muted tabular-nums">Uptime: {formatUptime(status.uptime)}</span>
  {:else if isStarting}
    <span class="text-xs text-text-muted">Starting up...</span>
  {/if}

  <!-- Description -->
  <p class="text-sm leading-relaxed text-text-dim">{env.description}</p>

  <!-- Repo path -->
  <div class="truncate font-mono text-[0.7rem] text-text-muted" title={env.repoDir}>
    {env.repoDir}
  </div>

  <!-- Per-env services -->
  <div class="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
    {#each env.services as svc (svc.id)}
      {@const svcUp = health[`${env.id}:${svc.id}`] === 'up'}
      <a
        href="http://localhost:{svc.port}"
        target="_blank"
        class="flex items-center gap-2 rounded-lg border border-transparent bg-bg px-3 py-2
               text-sm text-text-dim no-underline transition-all duration-150
               hover:border-border-active hover:text-gray-200"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full transition-all duration-300
                 {svcUp ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]' : 'bg-text-muted'}"
        ></span>
        <span class="font-medium">{svc.label}</span>
        <span class="ml-auto text-xs text-text-muted">:{svc.port}</span>
      </a>
    {/each}
  </div>

  <!-- Actions -->
  <div class="flex flex-wrap gap-2">
    <button
      class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white
             transition-all duration-150 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-35"
      disabled={isActive}
      onclick={handleStart}
    >
      {#if isStarting}
        Starting...
      {:else if isRunning}
        Running
      {:else}
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"
          ><polygon points="5 3 19 12 5 21 5 3" /></svg
        >
        Start
      {/if}
    </button>

    <button
      class="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-2 text-sm
             font-semibold text-red-500 transition-all duration-150 hover:bg-red-500/20
             disabled:cursor-not-allowed disabled:opacity-35"
      disabled={!isActive}
      onclick={handleStop}
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"
        ><rect x="6" y="6" width="12" height="12" rx="1" /></svg
      >
      Stop
    </button>

    <a
      href="http://localhost:{env.tiltPort}"
      target="_blank"
      class="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3.5 py-2
             text-sm font-medium text-blue-500 no-underline hover:bg-blue-500/20"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      Tilt Dashboard
    </a>
  </div>
</div>
