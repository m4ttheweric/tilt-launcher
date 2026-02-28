<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { usePersistedState } from '$lib/hooks/usePersistedState.svelte.ts';
  // Note: SvelteSet is still used for triggeringResources below
  import type { Environment, ResourceRow, Config, ServiceMapping, ResourceKind } from '$lib/types.ts';
  import { useTiltStatus } from '$lib/stores/useTiltStatus.svelte.ts';
  import { formatUptime, formatRelativeTime, formatBuildDuration } from '$lib/utils.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Spinner } from '$lib/components/ui/spinner/index.js';
  import * as Collapsible from '$lib/components/ui/collapsible/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import {
    ChevronRight,
    ChevronDown,
    Clock,
    DotIcon,
    ExternalLink,
    Hammer,
    Link2,
    Play,
    RotateCcw,
    RotateCw,
    Settings2,
    TerminalSquare,
    TriangleAlert,
  } from '@lucide/svelte';
  import ServiceMappingDialog from './ServiceMappingDialog.svelte';

  interface Props {
    config: Config | null;
    rightPaneCollapsed: boolean;
    onStart: (env: Environment) => void | Promise<void>;
    onStop: (env: Environment) => void | Promise<void>;
    onRestart: (env: Environment) => void | Promise<void>;
    onTriggerResource: (envId: string, resourceName: string) => void | Promise<void>;
    onEnableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onDisableResource: (envId: string, resourceName: string) => void | Promise<void>;
    onOpenExternal: (url: string) => void | Promise<void>;
    onSaveMapping: (envId: string, mapping: ServiceMapping) => void;
    onShowServiceLogs: (envId: string, serviceName: string) => void;
  }

  let {
    config,
    rightPaneCollapsed,
    onStart,
    onStop,
    onRestart,
    onTriggerResource,
    onEnableResource,
    onDisableResource,
    onOpenExternal,
    onSaveMapping,
    onShowServiceLogs,
  }: Props = $props();

  let mappingDialogEnv: Environment | null = $state(null);
  let triggeringResources = new SvelteSet<string>();
  const tilt = useTiltStatus();

  // — Collapsed state, persisted to localStorage —
  // Keys prefixed with 'env:' = top-level environment panels.
  // Keys in 'envId::groupId' format = resource group headers.
  const collapsed = usePersistedState({ key: 'tilt-launcher:collapsed-panels', defaultValue: [] as string[] });

  function isEnvCollapsed(envId: string): boolean {
    return collapsed.value.includes(`env:${envId}`);
  }

  function toggleEnv(envId: string): void {
    const key = `env:${envId}`;
    collapsed.value = collapsed.value.includes(key)
      ? collapsed.value.filter((k) => k !== key)
      : [...collapsed.value, key];
  }

  function isGroupCollapsed(envId: string, groupId: string): boolean {
    return collapsed.value.includes(`${envId}::${groupId}`);
  }

  function toggleGroup(envId: string, groupId: string): void {
    const key = `${envId}::${groupId}`;
    collapsed.value = collapsed.value.includes(key)
      ? collapsed.value.filter((k) => k !== key)
      : [...collapsed.value, key];
  }

  const statusClasses: Record<string, string> = {
    running: 'bg-emerald-400 text-emerald-950 border-emerald-300',
    starting: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    stopped: 'bg-muted text-muted-foreground border-border',
  };

  function healthDotClass(resource: ResourceRow): string {
    if (resource.isDisabled) return 'bg-slate-500';
    if (resource.updateStatus === 'error' || resource.lastBuildError) return 'bg-rose-500';
    if (resource.updateStatus === 'building' || resource.updateStatus === 'pending')
      return 'bg-amber-400 animate-pulse';
    if (resource.health === 'up') return 'bg-emerald-400';
    if (resource.health === 'missing') return 'bg-rose-500';
    if (resource.health === 'down') return 'bg-amber-500';
    return 'bg-muted-foreground';
  }

  function dotStatusLabel(resource: ResourceRow): string {
    if (resource.isDisabled) return 'Disabled';
    if (resource.updateStatus === 'error') return 'Build Error';
    if (resource.updateStatus === 'building') return 'Building';
    if (resource.updateStatus === 'pending') return 'Pending';
    if (resource.health === 'up') return 'Up';
    if (resource.health === 'missing') return 'Missing';
    if (resource.health === 'down') return 'Down';
    return 'Unknown';
  }

  /** Combined human-readable status from updateStatus + runtimeStatus */
  function combinedStatus(resource: ResourceRow): { text: string; className: string } {
    const us = resource.updateStatus;
    const rs = resource.runtimeStatus;

    if (resource.isDisabled) return { text: 'Disabled', className: 'text-slate-500' };
    if (us === 'error') return { text: 'Error', className: 'text-rose-400' };
    if (us === 'building') return { text: 'Building…', className: 'text-amber-400' };

    if (rs === 'pending') return { text: 'Starting…', className: 'text-amber-400' };
    if (us === 'pending') return { text: 'Pending', className: 'text-amber-400' };

    if (rs === 'ok') return { text: 'Ready', className: 'text-emerald-400' };
    if (rs === 'not_applicable' && us === 'ok') return { text: 'Done', className: 'text-muted-foreground' };
    if (rs === 'not_applicable') return { text: 'Idle', className: 'text-muted-foreground' };

    if (rs === 'error') return { text: 'Runtime Error', className: 'text-rose-400' };
    if (!rs || rs === 'unknown') return { text: '—', className: 'text-muted-foreground' };

    return { text: rs, className: 'text-muted-foreground' };
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

  async function handleTriggerResource(envId: string, resourceName: string): Promise<void> {
    const key = `${envId}:${resourceName}`;
    triggeringResources.add(key);
    try {
      await onTriggerResource(envId, resourceName);
    } finally {
      triggeringResources.delete(key);
    }
  }

  function isTriggering(envId: string, resourceName: string): boolean {
    return triggeringResources.has(`${envId}:${resourceName}`);
  }

  // — Grouped resource layout —

  interface RenderGroup {
    id: string;
    label: string;
    resources: ResourceRow[];
  }

  function buildRenderGroups(env: Environment, resources: ResourceRow[]): RenderGroup[] {
    const mapping = env.serviceMapping;
    const hidden = new Set(mapping?.hiddenResources ?? []);
    const subServiceChildren = new Set((mapping?.subServices ?? []).map((s) => s.childName));

    // Filter out hidden and sub-service resources
    const visible = resources.filter((r) => !hidden.has(r.name) && !subServiceChildren.has(r.name));

    // Apply ordering
    const order = mapping?.resourceOrder ?? [];
    const orderMap: Record<string, number> = {};
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      if (name !== undefined) orderMap[name] = i;
    }
    const sorted = [...visible].sort((a, b) => {
      const aIdx = orderMap[a.name] ?? 999;
      const bIdx = orderMap[b.name] ?? 999;
      return aIdx - bIdx;
    });

    // Build groups
    const customGroups = mapping?.groups ?? [];
    const customGroupMap: Record<string, string> = {}; // resourceName → groupId
    for (const group of customGroups) {
      for (const name of group.resourceNames) {
        customGroupMap[name] = group.id;
      }
    }

    const groupBuckets: Record<string, { label: string; resources: ResourceRow[] }> = {};
    // Initialize custom groups (preserve order)
    for (const group of customGroups) {
      groupBuckets[`custom:${group.id}`] = { label: group.label, resources: [] };
    }

    for (const resource of sorted) {
      const customGid = customGroupMap[resource.name];
      if (customGid) {
        const bucket = groupBuckets[`custom:${customGid}`];
        if (bucket) bucket.resources.push(resource);
      } else {
        // Fallback to original Tilt category
        const catKey = `cat:${resource.category}`;
        if (!groupBuckets[catKey]) {
          groupBuckets[catKey] = { label: resource.category, resources: [] };
        }
        const catBucket = groupBuckets[catKey];
        if (catBucket) catBucket.resources.push(resource);
      }
    }

    // Filter out empty groups, convert to array
    return Object.entries(groupBuckets)
      .filter(([, bucket]) => bucket.resources.length > 0)
      .map(([id, bucket]) => ({ id, label: bucket.label, resources: bucket.resources }));
  }

  function getSubServicesFor(env: Environment, parentName: string, resources: ResourceRow[]): ResourceRow[] {
    const mapping = env.serviceMapping;
    if (!mapping) return [];
    const childNames = mapping.subServices.filter((s) => s.parentName === parentName).map((s) => s.childName);
    if (childNames.length === 0) return [];
    const byName = new Map(resources.map((r) => [r.name, r]));
    return childNames.map((name) => byName.get(name)).filter((r): r is ResourceRow => r !== undefined);
  }

  function resourceDisplayLabel(env: Environment, resource: ResourceRow): string {
    return env.serviceMapping?.labelOverrides?.[resource.name] ?? resource.label;
  }

  function actionLabel(kind: ResourceKind): string {
    return kind === 'cmd' ? 'Run' : 'Trigger';
  }
</script>

<div class={`min-h-0 overflow-hidden ${!rightPaneCollapsed ? 'border-r border-border' : ''}`}>
  <ScrollArea class="h-full">
    <Tooltip.Provider>
      <div class="space-y-6 p-6">
        {#if config && config.environments.length > 0}
          {#each config.environments as env (env.id)}
            {@const envStatus = tilt.envs[env.id]}
            {@const envState = envStatus?.status ?? 'stopped'}
            {@const envIsRunning = envState === 'running'}
            {@const envIsStarting = envState === 'starting'}
            {@const envIsActive = envIsRunning || envIsStarting}
            {@const liveResources = envStatus?.resources ?? []}
            {@const fallbackResources = (env.cachedResources ?? []).map((r) => ({
              key: `${env.id}:${r.name}`,
              name: r.name,
              label: r.label ?? r.name,
              category: r.category ?? 'services',
              runtimeStatus: r.runtimeStatus ?? 'unknown',
              isDisabled: r.isDisabled ?? false,
              health: 'unknown' as const,
              exists: true,
              resourceKind: r.resourceKind ?? ('unknown' as const),
            }))}
            {@const resources = liveResources.length > 0 ? liveResources : fallbackResources}
            {@const renderGroups = buildRenderGroups(env, resources)}
            <Collapsible.Root
              open={!isEnvCollapsed(env.id)}
              class="overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm"
            >
              <Collapsible.Trigger
                class="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left [&[data-state=open]_.chevron]:rotate-90"
                onclick={() => toggleEnv(env.id)}
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
                  {#if env.external}
                    <Badge variant="secondary" class="text-[9px]">External</Badge>
                  {/if}
                  {#if (envStatus?.newResources ?? 0) > 0}
                    <Badge variant="secondary">{envStatus?.newResources} new</Badge>
                  {/if}
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          size="sm"
                          variant="ghost"
                          class="h-7 w-7 p-0"
                          onclick={(e) => {
                            e.stopPropagation();
                            mappingDialogEnv = env;
                          }}
                        >
                          <Settings2 class="h-4 w-4" />
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content sideOffset={6}>Organize services</Tooltip.Content>
                  </Tooltip.Root>
                  {#if !env.external}
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
                  {:else if envIsRunning}
                    <Button
                      size="sm"
                      variant="destructive"
                      class="h-7"
                      onclick={(e) => {
                        e.stopPropagation();
                        void onStop(env);
                      }}
                    >
                      Stop
                    </Button>
                  {/if}
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
                    <span class="font-mono text-gray-600 dark:text-gray-500"
                      >{env.external ? 'External — port only' : displayPath(env.repoDir)}</span
                    >
                  </p>
                  {#if env.description}
                    <p class="truncate text-[11px] text-muted-foreground">
                      {env.description}
                    </p>
                  {/if}
                  <p class="text-[11px] text-muted-foreground">Uptime: {formatUptime(envStatus?.uptime ?? null)}</p>
                </div>

                <div class="divide-y divide-border/70">
                  {#if renderGroups.length > 0}
                    {#each renderGroups as group (group.id)}
                      {@const groupCollapsed = isGroupCollapsed(env.id, group.id)}
                      <Collapsible.Root open={!groupCollapsed}>
                        <!-- Group header -->
                        <Collapsible.Trigger
                          class="flex w-full cursor-pointer items-center gap-1.5 bg-muted/10 px-3 py-1.5 transition-colors hover:bg-muted/20 [&[data-state=open]_.group-chevron]:rotate-180"
                          onclick={() => toggleGroup(env.id, group.id)}
                        >
                          <ChevronDown
                            class="group-chevron h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150"
                          />
                          <p class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                            {group.label}
                          </p>
                        </Collapsible.Trigger>

                        <Collapsible.Content
                          class="animation-duration-[120ms] [animation-timing-function:cubic-bezier(0.4,0,0.2,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
                        >
                          {#each group.resources as resource (resource.key)}
                            {@const subResources = getSubServicesFor(env, resource.name, resources)}
                            {@const label = resourceDisplayLabel(env, resource)}
                            {@const status = combinedStatus(resource)}
                            <div>
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
                                <div class="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                                  <div class="flex items-center gap-2">
                                    <span class="truncate font-medium text-foreground">{label}</span>
                                    <Badge
                                      variant={resource.resourceKind === 'serve' ? 'default' : 'secondary'}
                                      class="shrink-0 text-[9px]"
                                    >
                                      {resource.resourceKind === 'serve'
                                        ? 'serve'
                                        : resource.resourceKind === 'cmd'
                                          ? 'cmd'
                                          : '?'}
                                    </Badge>
                                    {#if resource.hasPendingChanges}
                                      <span
                                        class="inline-flex items-center gap-1 text-[10px] text-amber-400"
                                        title="Pending file changes"
                                      >
                                        <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                                        changed
                                      </span>
                                    {/if}
                                    <!-- Sub-service action buttons -->
                                    {#if subResources.length > 0}
                                      <div class="flex flex-wrap items-center gap-1.5">
                                        {#each subResources as sub (sub.key)}
                                          {@const subLabel = resourceDisplayLabel(env, sub)}
                                          <Tooltip.Root>
                                            <Tooltip.Trigger>
                                              {#snippet child({ props })}
                                                <Button
                                                  {...props}
                                                  variant="outline"
                                                  size="compact-sm"
                                                  color=""
                                                  disabled={!envIsActive || isTriggering(env.id, sub.name)}
                                                  onclick={() => void handleTriggerResource(env.id, sub.name)}
                                                >
                                                  {#if isTriggering(env.id, sub.name)}
                                                    <Spinner class="h-3 w-3" />
                                                  {/if}
                                                  {subLabel}
                                                </Button>
                                              {/snippet}
                                            </Tooltip.Trigger>
                                            <Tooltip.Content sideOffset={4}>Run {subLabel}</Tooltip.Content>
                                          </Tooltip.Root>
                                        {/each}
                                      </div>
                                    {/if}
                                  </div>
                                  {#if resource.waitingReason}
                                    <span class="truncate text-[10px] text-muted-foreground">
                                      Waiting: {resource.waitingReason}{#if resource.waitingOn && resource.waitingOn.length > 0}
                                        (on:
                                        {resource.waitingOn.join(', ')}){/if}
                                    </span>
                                  {/if}
                                </div>
                                <span class="truncate font-mono text-muted-foreground">
                                  {resource.port ? `:${resource.port}` : '—'}
                                </span>
                                <Tooltip.Root>
                                  <Tooltip.Trigger>
                                    {#snippet child({ props })}
                                      <span {...props} class={`truncate text-sm ${status.className}`}
                                        >{status.text}</span
                                      >
                                    {/snippet}
                                  </Tooltip.Trigger>
                                  <Tooltip.Content sideOffset={6} class="max-w-xs">
                                    <div class="space-y-1 text-xs">
                                      <div class="flex items-center gap-1.5">
                                        <Clock class="h-3 w-3 text-muted-foreground" />
                                        <span>Deployed: {formatRelativeTime(resource.lastDeployTime)}</span>
                                      </div>
                                      {#if resource.lastBuildDuration !== undefined}
                                        <div class="flex items-center gap-1.5">
                                          <Hammer class="h-3 w-3 text-muted-foreground" />
                                          <span>Built in {formatBuildDuration(resource.lastBuildDuration)}</span>
                                        </div>
                                      {/if}
                                      {#if resource.pid}
                                        <div class="flex items-center gap-1.5">
                                          <TerminalSquare class="h-3 w-3 text-muted-foreground" />
                                          <span>PID {resource.pid}</span>
                                        </div>
                                      {/if}
                                      {#if resource.conditions && resource.conditions.length > 0}
                                        <div class="mt-1 border-t border-border/50 pt-1">
                                          {#each resource.conditions as cond (cond.type)}
                                            <div class="flex items-center gap-1">
                                              <span
                                                class={cond.status === 'True'
                                                  ? 'text-emerald-400'
                                                  : 'text-muted-foreground'}>●</span
                                              >
                                              <span>{cond.type}</span>
                                            </div>
                                          {/each}
                                        </div>
                                      {/if}
                                    </div>
                                  </Tooltip.Content>
                                </Tooltip.Root>
                                <div class="flex items-center justify-center gap-1">
                                  <Tooltip.Root>
                                    <Tooltip.Trigger>
                                      {#snippet child({ props })}
                                        <Button
                                          {...props}
                                          variant="secondary"
                                          disabled={!envIsActive ||
                                            envIsStarting ||
                                            isTriggering(env.id, resource.name)}
                                          aria-label={`${actionLabel(resource.resourceKind)} ${label}`}
                                          onclick={() => void handleTriggerResource(env.id, resource.name)}
                                        >
                                          {#if isTriggering(env.id, resource.name)}
                                            <Spinner class="h-3.5 w-3.5" />
                                          {:else if resource.resourceKind === 'cmd'}
                                            <Play class="h-3.5 w-3.5" />
                                          {:else}
                                            <RotateCw class="h-3.5 w-3.5" />
                                          {/if}
                                        </Button>
                                      {/snippet}
                                    </Tooltip.Trigger>
                                    <Tooltip.Content sideOffset={6}
                                      >{actionLabel(resource.resourceKind)}</Tooltip.Content
                                    >
                                  </Tooltip.Root>
                                  <Tooltip.Root>
                                    <Tooltip.Trigger>
                                      {#snippet child({ props })}
                                        <Button
                                          {...props}
                                          variant="ghost"
                                          disabled={!resource.endpoint}
                                          aria-label={`Open ${label}`}
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
                                  <Tooltip.Root>
                                    <Tooltip.Trigger>
                                      {#snippet child({ props })}
                                        <Button
                                          {...props}
                                          variant="ghost"
                                          aria-label={`Show logs for ${label}`}
                                          onclick={() => onShowServiceLogs(env.id, resource.name)}
                                        >
                                          <TerminalSquare />
                                        </Button>
                                      {/snippet}
                                    </Tooltip.Trigger>
                                    <Tooltip.Content sideOffset={6}>Show logs</Tooltip.Content>
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
                                          aria-label={`${resource.isDisabled ? 'Enable' : 'Disable'} ${label}`}
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
                              {#if resource.lastBuildError}
                                <div
                                  class="flex items-center gap-1.5 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-400"
                                >
                                  <TriangleAlert class="h-3 w-3 shrink-0" />
                                  <span class="truncate">{resource.lastBuildError}</span>
                                </div>
                              {/if}
                              {#if resource.error}
                                <p class="px-3 pb-2 text-rose-400">{resource.error}</p>
                              {/if}
                            </div>
                          {/each}
                        </Collapsible.Content>
                      </Collapsible.Root>
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
</div>

{#if mappingDialogEnv}
  {@const mappingEnvResources = tilt.envs[mappingDialogEnv.id]?.resources ?? []}
  <ServiceMappingDialog
    open={true}
    env={mappingDialogEnv}
    liveResources={mappingEnvResources}
    onClose={() => (mappingDialogEnv = null)}
    onSave={(mapping) => {
      if (mappingDialogEnv) void onSaveMapping(mappingDialogEnv.id, mapping);
    }}
  />
{/if}
