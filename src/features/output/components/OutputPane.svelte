<script lang="ts">
  import type { Config, Environment, ResourceRow } from '$lib/types.ts';
  import { useTiltStatus } from '$lib/stores/useTiltStatus.svelte.ts';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import SplitterHandle from '$lib/components/SplitterHandle.svelte';
  import { ChevronDown, X, ArrowDown } from '@lucide/svelte';
  import { tick, onDestroy } from 'svelte';
  import { AnsiUp } from 'ansi_up';

  const ansi = new AnsiUp();
  ansi.use_classes = true;
  const tilt = useTiltStatus();

  // --- Sticky scroll (react-scroll-to-bottom pattern) ---
  let sentinelRef = $state<HTMLDivElement | null>(null);
  let stuckToBottom = $state(true);
  let observer: IntersectionObserver | null = null;

  $effect(() => {
    if (!sentinelRef) return;
    observer?.disconnect();
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) stuckToBottom = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(sentinelRef);
  });

  onDestroy(() => observer?.disconnect());

  function scrollToBottom(): void {
    sentinelRef?.scrollIntoView({ behavior: 'instant' });
  }

  function jumpToBottom(): void {
    stuckToBottom = true;
    sentinelRef?.scrollIntoView({ behavior: 'smooth' });
  }

  interface Props {
    config: Config | null;
    activeLogEnvId: string | null;
    logsCollapsed: boolean;
    onStartResize: (event: MouseEvent) => void;
    onRestore: () => void;
    onCollapse: () => void;
    onSelectEnv: (envId: string) => void;
  }

  let { config, activeLogEnvId, logsCollapsed, onStartResize, onRestore, onCollapse, onSelectEnv }: Props = $props();

  // Track the selected service filter per environment (null = All Services)
  let serviceFilter = $state<Record<string, string | null>>({});

  // External trigger: show a specific service's logs
  export function showServiceInLogs(envId: string, serviceName: string): void {
    serviceFilter = { ...serviceFilter, [envId]: serviceName };
    onSelectEnv(envId);
    if (logsCollapsed) onRestore();
    stuckToBottom = true;
    void tick().then(scrollToBottom);
  }

  function getFilteredLabel(envId: string, env: Environment): string {
    const filter = serviceFilter[envId];
    if (!filter) return env.name;
    const mapping = env.serviceMapping;
    return mapping?.labelOverrides?.[filter] ?? filter;
  }

  interface ServiceItem {
    name: string;
    label: string;
    kind: string;
    group?: string;
  }

  function getServiceItems(env: Environment, resources: ResourceRow[]): ServiceItem[] {
    const mapping = env.serviceMapping;
    const hidden = new Set(mapping?.hiddenResources ?? []);

    // Build ordered, visible list
    const order = mapping?.resourceOrder ?? [];
    const orderMap: Record<string, number> = {};
    for (let i = 0; i < order.length; i++) {
      const n = order[i];
      if (n !== undefined) orderMap[n] = i;
    }

    return resources
      .filter((r) => !hidden.has(r.name))
      .sort((a, b) => (orderMap[a.name] ?? 999) - (orderMap[b.name] ?? 999))
      .map((r) => {
        // Find group label
        let group: string | undefined;
        for (const g of mapping?.groups ?? []) {
          if (g.resourceNames.includes(r.name)) {
            group = g.label;
            break;
          }
        }
        return {
          name: r.name,
          label: mapping?.labelOverrides?.[r.name] ?? r.label,
          kind: r.resourceKind,
          group: group ?? r.category,
        };
      });
  }

  interface GroupedServiceItems {
    group: string;
    items: ServiceItem[];
  }

  function groupServiceItems(items: ServiceItem[]): GroupedServiceItems[] {
    const buckets: Record<string, ServiceItem[]> = {};
    const groupOrder: string[] = [];
    for (const item of items) {
      const g = item.group ?? 'services';
      if (!buckets[g]) {
        buckets[g] = [];
        groupOrder.push(g);
      }
      buckets[g]?.push(item);
    }
    return groupOrder.map((g) => ({ group: g, items: buckets[g] ?? [] }));
  }

  function selectService(envId: string, serviceName: string | null): void {
    serviceFilter = { ...serviceFilter, [envId]: serviceName };
  }

  // Auto-scroll logs to bottom only when stuck to bottom
  $effect(() => {
    // Touch reactive log state so this effect re-runs when logs change
    void tilt.envLogs;
    void tilt.resourceLogs;
    if (stuckToBottom) {
      void tick().then(() => sentinelRef?.scrollIntoView({ behavior: 'instant' }));
    }
  });
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

<div class={`flex min-h-0 flex-col overflow-hidden p-1 pt-0 ${logsCollapsed ? 'hidden' : ''}`}>
  <Tabs.Root
    value={activeLogEnvId ?? ''}
    onValueChange={(val) => {
      if (val) onSelectEnv(val);
    }}
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="flex h-7 shrink-0 items-center border-b border-border bg-muted/30">
      <div class="flex flex-1 items-center gap-0.5 overflow-hidden px-1.5">
        {#if config}
          {#each config.environments as env (env.id)}
            {@const isActive = activeLogEnvId === env.id}
            {@const liveResources = tilt.envs[env.id]?.resources ?? []}
            {@const fallbackResources = (env.cachedResources ?? []).map((r) => ({
              key: `${env.id}:${r.name}`,
              name: r.name,
              label: r.label ?? r.name,
              category: r.category ?? 'services',
              runtimeStatus: r.runtimeStatus ?? 'unknown',
              isDisabled: r.isDisabled ?? false,
              health: 'unknown' as const,
              exists: true,
              resourceKind: r.resourceKind ?? 'unknown',
            }))}
            {@const resources = liveResources.length > 0 ? liveResources : fallbackResources}
            {@const items = getServiceItems(env, resources)}
            {@const groups = groupServiceItems(items)}
            <div class="flex items-center overflow-hidden">
              <Tabs.Trigger
                variant="minimal"
                value={env.id}
                class={isActive && items.length > 0 ? 'gap-0 rounded-r-none pr-1' : ''}
              >
                <span>{getFilteredLabel(env.id, env)}</span>
              </Tabs.Trigger>
              {#if isActive && items.length > 0}
                <Popover.Root>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <button
                        {...props}
                        class="inline-flex h-[22px] items-center justify-center rounded-r-md bg-muted px-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronDown class="h-3 w-3" />
                      </button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-52 p-1" align="start" sideOffset={4}>
                    <button
                      class="flex w-full items-center rounded px-2 py-1 text-left text-[11px] font-medium transition-colors {!serviceFilter[
                        env.id
                      ]
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
                      onclick={() => selectService(env.id, null)}
                    >
                      All Services
                    </button>
                    {#each groups as group (group.group)}
                      <p
                        class="mt-1.5 mb-0.5 px-2 text-[9px] font-semibold tracking-wide text-muted-foreground/70 uppercase"
                      >
                        {group.group}
                      </p>
                      {#each group.items as item (item.name)}
                        <button
                          class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors {serviceFilter[
                            env.id
                          ] === item.name
                            ? 'bg-muted font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
                          onclick={() => selectService(env.id, item.name)}
                        >
                          <span class="truncate">{item.label}</span>
                          <span class="shrink-0 text-[9px] text-muted-foreground/60">{item.kind}</span>
                        </button>
                      {/each}
                    {/each}
                  </Popover.Content>
                </Popover.Root>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
      <div class="flex shrink-0 items-center px-1">
        <button
          type="button"
          class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Minimize output pane"
          onclick={onCollapse}
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    {#if config}
      {#each config.environments as env (env.id)}
        {@const filter = serviceFilter[env.id]}
        {@const logLines = filter ? (tilt.resourceLogs[`${env.id}:${filter}`] ?? []) : (tilt.envLogs[env.id] ?? [])}
        <Tabs.Content value={env.id} class="relative min-h-0 flex-1">
          {#if activeLogEnvId === env.id}
            <ScrollArea class="h-full">
              <div class="p-4">
                <pre
                  class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{@html ansi.ansi_to_html(
                    logLines.join('\n'),
                  ) || 'No logs yet.'}</pre>
                <!-- Sentinel: IntersectionObserver watches this to know if we're at bottom -->
                <div bind:this={sentinelRef} class="h-px"></div>
              </div>
            </ScrollArea>
            {#if !stuckToBottom}
              <button
                class="absolute right-6 bottom-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-muted/90 text-muted-foreground shadow-md ring-1 ring-border/50 backdrop-blur transition-all hover:bg-muted hover:text-foreground"
                onclick={jumpToBottom}
                aria-label="Scroll to bottom"
              >
                <ArrowDown class="h-3.5 w-3.5" />
              </button>
            {/if}
          {/if}
        </Tabs.Content>
      {/each}
    {/if}
  </Tabs.Root>
</div>
