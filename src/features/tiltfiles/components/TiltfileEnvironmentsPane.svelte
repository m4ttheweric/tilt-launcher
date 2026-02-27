<script lang="ts">
  import type { Environment, ResourceRow, StatusResponse, Config } from '$lib/types.ts';
  import { formatUptime } from '$lib/utils.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { ChevronRight, DotIcon, ExternalLink, Link2, RotateCcw, RotateCw } from '@lucide/svelte';

  interface Props {
    config: Config | null;
    statusData: StatusResponse;
    rightPaneCollapsed: boolean;
    onOpenTilt: (env: Environment) => void;
    onStart: (env: Environment) => void | Promise<void>;
    onStop: (env: Environment) => void | Promise<void>;
    onRestart: (env: Environment) => void | Promise<void>;
    onTriggerResource: (envId: string, resourceName: string) => void | Promise<void>;
    onEnableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onDisableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onOpenExternal: (url: string) => void | Promise<void>;
  }

  let {
    config,
    statusData,
    rightPaneCollapsed,
    onStart,
    onStop,
    onRestart,
    onTriggerResource,
    onEnableResource,
    onDisableResource,
    onOpenExternal,
  }: Props = $props();

  const statusClasses: Record<string, string> = {
    running: 'bg-emerald-400 text-emerald-950 border-emerald-300',
    starting: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    stopped: 'bg-muted text-muted-foreground border-border',
  };

  function healthDotClass(resource: ResourceRow): string {
    if (resource.isDisabled) return 'bg-slate-500';
    if (resource.health === 'up') return 'bg-emerald-400';
    if (resource.health === 'missing') return 'bg-rose-500';
    if (resource.health === 'down') return 'bg-amber-500';
    return 'bg-muted-foreground';
  }

  function dotStatusLabel(resource: ResourceRow): string {
    if (resource.isDisabled) return 'Disabled';
    if (resource.health === 'up') return 'Up';
    if (resource.health === 'missing') return 'Missing';
    if (resource.health === 'down') return 'Down';
    return 'Unknown';
  }

  function toggleResourceEnabled(envId: string, resource: ResourceRow): void {
    if (resource.isDisabled) {
      void onEnableResource(envId, resource.name);
      return;
    }
    void onDisableResource(envId, resource.name);
  }

  function displayPath(path: string): string {
    return path.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/');
  }
</script>

<ScrollArea class={!rightPaneCollapsed ? 'border-r border-border' : ''}>
  <Tooltip.Provider>
    <div class="space-y-3 p-3">
      {#if config && config.environments.length > 0}
        {#each config.environments as env (env.id)}
          {@const envStatus = statusData.envs[env.id]}
          {@const envState = envStatus?.status ?? 'stopped'}
          {@const envIsRunning = envState === 'running'}
          {@const envIsStarting = envState === 'starting'}
          {@const envIsActive = envIsRunning || envIsStarting}
          <Collapsible.Root open={true} class="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm">
            <Collapsible.Trigger
              class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left [&[data-state=open]_.chevron]:rotate-90"
            >
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <ChevronRight
                  class="chevron h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150"
                />
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
              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant={envIsRunning ? 'destructive' : 'default'}
                  class="h-7"
                  onclick={(e) => {
                    e.stopPropagation();
                    if (envIsRunning) {
                      void onStop(env);
                    } else {
                      void onStart(env);
                    }
                  }}
                  disabled={envIsStarting}
                >
                  {envIsStarting ? 'Starting...' : envIsRunning ? 'Stop' : 'Start'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-7"
                  onclick={(e) => {
                    e.stopPropagation();
                    void onRestart(env);
                  }}
                  disabled={envIsStarting}
                >
                  <RotateCcw class="size-3.5" />
                  Restart
                </Button>
              </div>
            </Collapsible.Trigger>

            <Collapsible.Content
              class="overflow-hidden border-t border-border animation-duration-[120ms] [animation-timing-function:cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
            >
              <div class="space-y-1 border-b border-border/80 bg-muted/20 px-3 py-2">
                <p class="flex flex-row items-center truncate text-[11px] text-muted-foreground">
                  <Button
                    variant="link"
                    size="sm"
                    class="px-0"
                    onclick={() => void onOpenExternal(`http://localhost:${env.tiltPort}`)}
                    >localhost:{env.tiltPort}</Button
                  >
                  <DotIcon />
                  <span class="font-mono text-gray-600 dark:text-gray-500">{displayPath(env.repoDir)}</span>
                </p>
                {#if env.description}
                  <p class="truncate text-[11px] text-muted-foreground">
                    {env.description}
                  </p>
                {/if}
                <p class="text-[11px] text-muted-foreground">Uptime: {formatUptime(envStatus?.uptime ?? null)}</p>
              </div>

              <div class="px-3 py-1.5">
                <div
                  class="grid grid-cols-[56px_minmax(0,1fr)_72px_88px_86px_76px] items-center gap-2 border-b border-border/70 pb-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  <span class="text-center">Status</span>
                  <span>Resource</span>
                  <span>Port</span>
                  <span>Runtime</span>
                  <span class="text-center">Actions</span>
                  <span class="text-center">Enabled</span>
                </div>
              </div>

              <div class="divide-y divide-border/70">
                {#if envStatus?.resources && envStatus.resources.length > 0}
                  {#each envStatus.resources as resource (resource.key)}
                    <div
                      class={`grid grid-cols-[56px_minmax(0,1fr)_72px_88px_86px_76px] items-center gap-2 px-3 py-2 ${
                        resource.isDisabled ? 'opacity-70' : ''
                      }`}
                    >
                      <div class="flex items-center justify-center">
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <span
                                {...props}
                                class={`inline-block h-4 w-4 rounded-full ${healthDotClass(resource)}`}
                                aria-label={`Status: ${dotStatusLabel(resource)}`}
                              ></span>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content sideOffset={6}>Status: {dotStatusLabel(resource)}</Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                      <div class="flex min-w-0 items-center gap-2 overflow-hidden">
                        <span class="truncate font-medium text-foreground">{resource.label}</span>
                        <span class="truncate text-muted-foreground">({resource.category})</span>
                      </div>
                      <span class="truncate font-mono text-muted-foreground">
                        {resource.port ? `:${resource.port}` : '—'}
                      </span>
                      <span class="truncate text-muted-foreground capitalize">{resource.runtimeStatus}</span>
                      <div class="flex items-center justify-center gap-1">
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <Button
                                {...props}
                                variant="secondary"
                                disabled={!envIsActive || envIsStarting}
                                aria-label={`Trigger ${resource.label}`}
                                onclick={() => void onTriggerResource(env.id, resource.name)}
                              >
                                <RotateCw />
                              </Button>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content sideOffset={6}>Trigger</Tooltip.Content>
                        </Tooltip.Root>
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <Button
                                {...props}
                                variant="ghost"
                                disabled={!resource.endpoint}
                                aria-label={`Open ${resource.label}`}
                                onclick={() => {
                                  if (!resource.endpoint) return;
                                  void onOpenExternal(resource.endpoint);
                                }}
                              >
                                <ExternalLink />
                              </Button>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content sideOffset={6}>Open</Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                      <div class="flex items-center justify-center">
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <Checkbox
                                {...props}
                                checked={!resource.isDisabled}
                                disabled={!envIsActive || envIsStarting}
                                class="size-5 data-[state=checked]:border-emerald-500! data-[state=checked]:bg-emerald-500! data-[state=checked]:text-white!"
                                aria-label={`${resource.isDisabled ? 'Enable' : 'Disable'} ${resource.label}`}
                                onclick={() => toggleResourceEnabled(env.id, resource)}
                              />
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content sideOffset={6}>
                            {resource.isDisabled ? 'Enable resource' : 'Disable resource'}
                          </Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    </div>
                    {#if resource.error}
                      <p class="px-3 pb-2 text-rose-400">{resource.error}</p>
                    {/if}
                  {/each}
                {:else}
                  <p class="px-3 py-3 text-muted-foreground">No selected resources configured.</p>
                {/if}
              </div>
            </Collapsible.Content>
          </Collapsible.Root>
        {/each}
      {:else}
        <div class="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground">
          No environments configured yet. Open Settings to add your first Tiltfile.
        </div>
      {/if}
    </div>
  </Tooltip.Provider>
</ScrollArea>
