<script lang="ts">
  import type { Environment, ResourceRow, StatusResponse, Config } from '$lib/types.ts';
  import { formatUptime } from '$lib/utils.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Link2 from '@lucide/svelte/icons/link-2';

  interface Props {
    config: Config | null;
    statusData: StatusResponse;
    rightPaneCollapsed: boolean;
    onOpenTilt: (env: Environment) => void;
    onStart: (env: Environment) => void | Promise<void>;
    onStop: (env: Environment) => void | Promise<void>;
    onOpenExternal: (url: string) => void | Promise<void>;
  }

  let { config, statusData, rightPaneCollapsed, onOpenTilt, onStart, onStop, onOpenExternal }: Props = $props();

  const statusClasses: Record<string, string> = {
    running: 'bg-emerald-400 text-emerald-950 border-emerald-300',
    starting: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    stopped: 'bg-muted text-muted-foreground border-border',
  };

  function healthDotClass(resource: ResourceRow): string {
    if (resource.health === 'up') return 'bg-emerald-400';
    if (resource.health === 'missing') return 'bg-rose-500';
    return 'bg-muted-foreground';
  }
</script>

<ScrollArea class={!rightPaneCollapsed ? 'border-r border-border' : ''}>
  <div class="space-y-3 p-3">
    {#if config && config.environments.length > 0}
      {#each config.environments as env (env.id)}
        {@const envStatus = statusData.envs[env.id]}
        {@const envState = envStatus?.status ?? 'stopped'}
        {@const envIsRunning = envState === 'running'}
        {@const envIsStarting = envState === 'starting'}
        {@const envIsActive = envIsRunning || envIsStarting}
        <Collapsible.Root open={true} class="overflow-hidden rounded-md border border-border bg-card">
          <Collapsible.Trigger
            class="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left [&[data-state=open]>.chevron]:rotate-90"
          >
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <ChevronRight class="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150" />
              <h2 class="truncate text-sm font-semibold">{env.name}</h2>
              {#if env.isSymlink}
                <span title="Tiltfile is a symlink">
                  <Link2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </span>
              {/if}
              <Badge class={`border ${statusClasses[envStatus?.status ?? 'stopped'] ?? statusClasses.stopped}`}>
                {envState}
              </Badge>
              {#if (envStatus?.newResources ?? 0) > 0}
                <Badge variant="secondary">{envStatus?.newResources} new</Badge>
              {/if}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onclick={(e) => {
                  e.stopPropagation();
                  onOpenTilt(env);
                }}>Open Tilt</Button
              >
              <Button
                size="sm"
                onclick={(e) => {
                  e.stopPropagation();
                  void onStart(env);
                }}
                disabled={envIsActive}>{envIsStarting ? 'Starting...' : envIsRunning ? 'Running' : 'Start'}</Button
              >
              <Button
                size="sm"
                variant="outline"
                onclick={(e) => {
                  e.stopPropagation();
                  void onStop(env);
                }}
                disabled={!envIsActive}>Stop</Button
              >
            </div>
          </Collapsible.Trigger>

          <Collapsible.Content
            class="overflow-hidden border-t border-border [animation-duration:120ms] [animation-timing-function:cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
          >
            <div class="space-y-0.5 px-3 py-2">
              <p class="truncate font-mono text-[11px] text-muted-foreground">{env.repoDir}</p>
              <p class="truncate text-[11px] text-muted-foreground">
                {env.tiltfile} ·
                <button
                  type="button"
                  class="font-mono text-[11px] text-blue-400 underline-offset-2 hover:underline"
                  onclick={() => void onOpenExternal(`http://localhost:${env.tiltPort}`)}
                  >localhost:{env.tiltPort}</button
                >
                {#if env.description}· {env.description}{/if}
              </p>
              <p class="text-[11px] text-muted-foreground">Uptime: {formatUptime(envStatus?.uptime ?? null)}</p>
            </div>
            <div class="divide-y divide-border">
              {#if envStatus?.resources && envStatus.resources.length > 0}
                {#each envStatus.resources as resource (resource.key)}
                  <div
                    class="grid grid-cols-[minmax(0,1.4fr)_minmax(58px,0.55fr)_minmax(76px,0.55fr)_minmax(62px,0.45fr)_88px] items-center gap-2 px-3 py-1.5 text-xs"
                  >
                    <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
                      <span class={`inline-block h-2.5 w-2.5 rounded-full ${healthDotClass(resource)}`}></span>
                      <span class="truncate font-medium">{resource.label}</span>
                      <span class="truncate text-[11px] text-muted-foreground">({resource.category})</span>
                    </div>
                    <span class="truncate font-mono text-[11px] text-muted-foreground">
                      {resource.port ? `:${resource.port}` : '—'}
                    </span>
                    <span class="truncate text-[11px] text-muted-foreground capitalize">{resource.runtimeStatus}</span>
                    <span class="truncate text-[11px] text-muted-foreground uppercase">{resource.health}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!resource.endpoint}
                      onclick={() => {
                        if (!resource.endpoint) return;
                        void onOpenExternal(resource.endpoint);
                      }}
                    >
                      Open
                    </Button>
                  </div>
                  {#if resource.error}
                    <p class="px-3 pb-2 text-[11px] text-rose-400">{resource.error}</p>
                  {/if}
                {/each}
              {:else}
                <p class="px-3 py-2 text-xs text-muted-foreground">No selected resources configured.</p>
              {/if}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      {/each}
    {:else}
      <div class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No environments configured yet. Open Settings to add your first Tiltfile.
      </div>
    {/if}
  </div>
</ScrollArea>
