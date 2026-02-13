<script lang="ts">
  import type { Environment, HealthStatus } from '../types.ts';

  interface Props {
    environments: Environment[];
    health: Record<string, HealthStatus>;
  }

  let { environments = [], health = {} }: Props = $props();
</script>

<div class="mb-6 flex flex-wrap justify-center gap-2">
  {#each environments as env (env.id)}
    {#each env.services as svc (svc.id)}
      {@const key = `${env.id}:${svc.id}`}
      {@const up = health[key] === 'up'}
      <a
        href="http://localhost:{svc.port}"
        target="_blank"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-surface px-3.5
               py-1.5 text-xs font-medium no-underline transition-all duration-200
               {up
          ? 'border-green-500/25 text-gray-200'
          : 'border-border text-text-dim hover:border-border-active hover:text-gray-200'}"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full transition-all duration-300
                 {up ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-text-muted'}"
        ></span>
        {svc.label} :{svc.port}
      </a>
    {/each}

    {@const tiltUp = health[`${env.id}:tilt`] === 'up'}
    <a
      href="http://localhost:{env.tiltPort}"
      target="_blank"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border bg-surface px-3.5
             py-1.5 text-xs font-medium no-underline transition-all duration-200
             {tiltUp
        ? 'border-green-500/25 text-gray-200'
        : 'border-border text-text-dim hover:border-border-active hover:text-gray-200'}"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full transition-all duration-300
               {tiltUp ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-text-muted'}"
      ></span>
      Tilt {env.name} :{env.tiltPort}
    </a>
  {/each}
</div>
