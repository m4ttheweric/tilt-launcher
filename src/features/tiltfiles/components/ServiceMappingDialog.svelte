<script lang="ts">
  import type { CachedResource, Environment, ServiceMapping, ServiceGroup, SubServiceMapping } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Tooltip from '$lib/components/ui/tooltip/index.js';
  import { Eye, EyeOff, GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Pencil, X, Check } from '@lucide/svelte';

  interface Props {
    open: boolean;
    env: Environment;
    /** Live resources from tilt status — used as fallback when cachedResources is empty (external envs). */
    liveResources?: CachedResource[];
    onClose: () => void;
    onSave: (mapping: ServiceMapping) => void;
  }

  let { open, env, liveResources, onClose, onSave }: Props = $props();

  // — Draft state —
  let groups = $state<ServiceGroup[]>([]);
  let subServices = $state<SubServiceMapping[]>([]);
  let labelOverrides = $state<Record<string, string>>({});
  let resourceOrder = $state<string[]>([]);
  let hiddenResources = $state<string[]>([]);
  let newGroupName = $state('');
  let editingGroupId = $state<string | null>(null);
  let editingGroupLabel = $state('');
  let editingResourceName = $state<string | null>(null);
  let editingResourceLabel = $state('');

  // Initialize draft from env
  $effect(() => {
    if (!open) return;
    const mapping = env.serviceMapping;
    groups = mapping?.groups ? (JSON.parse(JSON.stringify(mapping.groups)) as ServiceGroup[]) : [];
    subServices = mapping?.subServices ? (JSON.parse(JSON.stringify(mapping.subServices)) as SubServiceMapping[]) : [];
    labelOverrides = mapping?.labelOverrides ? { ...mapping.labelOverrides } : {};
    hiddenResources = mapping?.hiddenResources ? [...mapping.hiddenResources] : [];

    // Default order: group by Tilt category, preserving order within each category
    const resources = (env.cachedResources ?? []).length > 0 ? (env.cachedResources ?? []) : (liveResources ?? []);
    const allNames = resources.map((r) => r.name);
    if (mapping?.resourceOrder?.length) {
      resourceOrder = [...mapping.resourceOrder, ...allNames.filter((n) => !mapping.resourceOrder.includes(n))];
    } else {
      // Group by category, with a sensible category sort order
      const categoryOrder = ['apps', 'services', 'setup', 'tools'];
      const byCategory: Record<string, string[]> = {};
      for (const r of resources) {
        const cat = r.category ?? 'services';
        const list = byCategory[cat] ?? [];
        list.push(r.name);
        byCategory[cat] = list;
      }
      const sorted: string[] = [];
      const used: Record<string, true> = {};
      for (const cat of categoryOrder) {
        for (const name of byCategory[cat] ?? []) sorted.push(name);
        used[cat] = true;
      }
      // Append any remaining categories not in the predefined order
      for (const [cat, names] of Object.entries(byCategory)) {
        if (used[cat]) continue;
        for (const name of names) sorted.push(name);
      }
      resourceOrder = sorted;
    }
  });

  // Use cachedResources, falling back to liveResources for external envs
  let allResources = $derived<CachedResource[]>(
    (env.cachedResources ?? []).length > 0 ? (env.cachedResources ?? []) : (liveResources ?? []),
  );

  // All serve resources (for parent dropdown)
  let serveResources = $derived(allResources.filter((r) => r.resourceKind === 'serve'));

  // Get the group a resource belongs to (if any)
  function getResourceGroup(name: string): string | null {
    for (const group of groups) {
      if (group.resourceNames.includes(name)) return group.id;
    }
    return null;
  }

  // Get parent of a sub-service
  function getParent(childName: string): string | null {
    return subServices.find((s) => s.childName === childName)?.parentName ?? null;
  }

  // Display label for a resource
  function displayLabel(name: string): string {
    return labelOverrides[name] ?? name;
  }

  // Is resource hidden?
  function isHidden(name: string): boolean {
    return hiddenResources.includes(name);
  }

  // Get resource kind
  function getKind(name: string): string {
    return allResources.find((r) => r.name === name)?.resourceKind ?? 'unknown';
  }

  function getCategory(name: string): string {
    return allResources.find((r) => r.name === name)?.category ?? 'services';
  }

  // — Actions —
  function addGroup(): void {
    const label = newGroupName.trim();
    if (!label) return;
    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (groups.some((g) => g.id === id)) return;
    groups = [...groups, { id, label, resourceNames: [] }];
    newGroupName = '';
  }

  function removeGroup(groupId: string): void {
    groups = groups.filter((g) => g.id !== groupId);
  }

  function startEditGroup(group: ServiceGroup): void {
    editingGroupId = group.id;
    editingGroupLabel = group.label;
  }

  function saveEditGroup(): void {
    if (!editingGroupId) return;
    const label = editingGroupLabel.trim();
    if (!label) return;
    groups = groups.map((g) => (g.id === editingGroupId ? { ...g, label } : g));
    editingGroupId = null;
    editingGroupLabel = '';
  }

  function cancelEditGroup(): void {
    editingGroupId = null;
    editingGroupLabel = '';
  }

  function moveToGroup(resourceName: string, groupId: string | null): void {
    // Remove from all groups first
    groups = groups.map((g) => ({
      ...g,
      resourceNames: g.resourceNames.filter((n) => n !== resourceName),
    }));
    if (groupId) {
      groups = groups.map((g) => (g.id === groupId ? { ...g, resourceNames: [...g.resourceNames, resourceName] } : g));
    }
  }

  function setParent(childName: string, parentName: string | null): void {
    subServices = subServices.filter((s) => s.childName !== childName);
    if (parentName) {
      subServices = [...subServices, { parentName, childName }];
    }
  }

  function toggleHidden(name: string): void {
    if (isHidden(name)) {
      hiddenResources = hiddenResources.filter((n) => n !== name);
    } else {
      hiddenResources = [...hiddenResources, name];
    }
  }

  function startEditResource(name: string): void {
    editingResourceName = name;
    editingResourceLabel = displayLabel(name);
  }

  function saveEditResource(): void {
    if (!editingResourceName) return;
    const label = editingResourceLabel.trim();
    if (label && label !== editingResourceName) {
      labelOverrides = { ...labelOverrides, [editingResourceName]: label };
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [editingResourceName]: _removed, ...rest } = labelOverrides;
      labelOverrides = rest;
    }
    editingResourceName = null;
    editingResourceLabel = '';
  }

  function cancelEditResource(): void {
    editingResourceName = null;
    editingResourceLabel = '';
  }

  function moveUp(name: string): void {
    const idx = resourceOrder.indexOf(name);
    if (idx <= 0) return;
    const next = [...resourceOrder];
    const prev = next[idx - 1];
    const curr = next[idx];
    if (prev === undefined || curr === undefined) return;
    next[idx - 1] = curr;
    next[idx] = prev;
    resourceOrder = next;
  }

  function moveDown(name: string): void {
    const idx = resourceOrder.indexOf(name);
    if (idx < 0 || idx >= resourceOrder.length - 1) return;
    const next = [...resourceOrder];
    const curr = next[idx];
    const following = next[idx + 1];
    if (curr === undefined || following === undefined) return;
    next[idx] = following;
    next[idx + 1] = curr;
    resourceOrder = next;
  }

  function handleSave(): void {
    onSave({ groups, subServices, labelOverrides, resourceOrder, hiddenResources });
    onClose();
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Dialog.Content class="gap-0 p-0 sm:max-w-[56rem]!">
    <Dialog.Header class="border-b border-border px-4 py-3">
      <Dialog.Title>Organize Services — {env.name}</Dialog.Title>
      <Dialog.Description>Create groups, assign sub-services, hide or rename resources.</Dialog.Description>
    </Dialog.Header>

    <ScrollArea class="max-h-[70vh]">
      <Tooltip.Provider>
        <div class="space-y-4 p-4">
          <!-- Group Management -->
          <div>
            <h4 class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Groups</h4>
            <div class="space-y-1.5">
              {#each groups as group (group.id)}
                <div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5">
                  {#if editingGroupId === group.id}
                    <Input
                      class="h-7 flex-1 text-xs"
                      value={editingGroupLabel}
                      oninput={(e) => (editingGroupLabel = e.currentTarget.value)}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') saveEditGroup();
                        if (e.key === 'Escape') cancelEditGroup();
                      }}
                    />
                    <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={saveEditGroup}>
                      <Check class="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={cancelEditGroup}>
                      <X class="h-3.5 w-3.5" />
                    </Button>
                  {:else}
                    <span class="flex-1 text-sm font-medium">{group.label}</span>
                    <Badge variant="secondary" class="text-[10px]">{group.resourceNames.length}</Badge>
                    <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={() => startEditGroup(group)}>
                      <Pencil class="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 w-7 p-0 text-destructive"
                      onclick={() => removeGroup(group.id)}
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </Button>
                  {/if}
                </div>
              {/each}
            </div>
            <div class="mt-2 flex gap-2">
              <Input
                class="h-8 flex-1 text-xs"
                placeholder="New group name…"
                value={newGroupName}
                oninput={(e) => (newGroupName = e.currentTarget.value)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') addGroup();
                }}
              />
              <Button variant="secondary" size="sm" class="h-8" onclick={addGroup} disabled={!newGroupName.trim()}>
                <Plus class="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>

          <Separator />

          <!-- Resource List -->
          <div>
            <h4 class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Resources</h4>
            <div class="space-y-1">
              {#each resourceOrder as resourceName, i (resourceName)}
                {@const kind = getKind(resourceName)}
                {@const category = getCategory(resourceName)}
                {@const prevCategory = i > 0 ? getCategory(resourceOrder[i - 1] ?? '') : null}
                {#if category !== prevCategory}
                  <p
                    class="mt-3 mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase first:mt-0"
                  >
                    {category}
                  </p>
                {/if}
                {@const hidden = isHidden(resourceName)}
                {@const parentName = getParent(resourceName)}
                {@const groupId = getResourceGroup(resourceName)}
                <div
                  class="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 {hidden
                    ? 'opacity-50'
                    : ''}"
                >
                  <!-- Drag handle / reorder -->
                  <div class="flex shrink-0 flex-col gap-0.5">
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() => moveUp(resourceName)}
                          >
                            <ArrowUp class="h-3 w-3" />
                          </button>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content sideOffset={4}>Move up</Tooltip.Content>
                    </Tooltip.Root>
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            class="text-muted-foreground hover:text-foreground"
                            onclick={() => moveDown(resourceName)}
                          >
                            <ArrowDown class="h-3 w-3" />
                          </button>
                        {/snippet}
                      </Tooltip.Trigger>
                      <Tooltip.Content sideOffset={4}>Move down</Tooltip.Content>
                    </Tooltip.Root>
                  </div>

                  <GripVertical class="h-4 w-4 shrink-0 text-muted-foreground/50" />

                  <!-- Name / editing -->
                  <div class="min-w-0 flex-1">
                    {#if editingResourceName === resourceName}
                      <div class="flex items-center gap-1">
                        <Input
                          class="h-7 flex-1 text-xs"
                          value={editingResourceLabel}
                          oninput={(e) => (editingResourceLabel = e.currentTarget.value)}
                          onkeydown={(e) => {
                            if (e.key === 'Enter') saveEditResource();
                            if (e.key === 'Escape') cancelEditResource();
                          }}
                        />
                        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={saveEditResource}>
                          <Check class="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={cancelEditResource}>
                          <X class="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    {:else}
                      <button
                        class="flex items-center gap-1 truncate text-sm font-medium text-foreground hover:underline"
                        onclick={() => startEditResource(resourceName)}
                      >
                        {displayLabel(resourceName)}
                        {#if labelOverrides[resourceName]}
                          <span class="text-[10px] text-muted-foreground">({resourceName})</span>
                        {/if}
                        <Pencil class="ml-0.5 inline h-3 w-3 text-muted-foreground" />
                      </button>
                    {/if}
                  </div>

                  <!-- Kind badge -->
                  <Badge variant={kind === 'serve' ? 'default' : 'secondary'} class="shrink-0 text-[10px]">
                    {kind === 'serve' ? 'serve' : kind === 'cmd' ? 'cmd' : '?'}
                  </Badge>

                  <!-- Group select (hidden for child commands with a parent) -->
                  {#if !parentName}
                    <Select.Root
                      type="single"
                      value={groupId ?? ''}
                      onValueChange={(val) => moveToGroup(resourceName, val || null)}
                    >
                      <Select.Trigger class="h-7 w-[120px] shrink-0 text-[10px]">
                        {groupId ? (groups.find((g) => g.id === groupId)?.label ?? 'Group') : 'No group'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="" label="No group">No group</Select.Item>
                        {#each groups as group (group.id)}
                          <Select.Item value={group.id} label={group.label}>{group.label}</Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  {:else}
                    <span class="w-[120px] shrink-0 text-center text-[10px] text-muted-foreground">follows parent</span>
                  {/if}

                  <!-- Sub-service (cmd only) -->
                  {#if kind === 'cmd'}
                    <Select.Root
                      type="single"
                      value={parentName ?? ''}
                      onValueChange={(val) => setParent(resourceName, val || null)}
                    >
                      <Select.Trigger class="h-7 w-[120px] shrink-0 text-[10px]">
                        {parentName ? displayLabel(parentName) : 'No parent'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="" label="No parent">No parent</Select.Item>
                        {#each serveResources as srv (srv.name)}
                          <Select.Item value={srv.name} label={displayLabel(srv.name)}>
                            {displayLabel(srv.name)}
                          </Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                  {/if}

                  <!-- Hide toggle -->
                  <Tooltip.Root>
                    <Tooltip.Trigger>
                      {#snippet child({ props })}
                        <Button
                          {...props}
                          variant="ghost"
                          size="sm"
                          class="h-7 w-7 shrink-0 p-0"
                          onclick={() => toggleHidden(resourceName)}
                        >
                          {#if hidden}
                            <EyeOff class="h-3.5 w-3.5" />
                          {:else}
                            <Eye class="h-3.5 w-3.5" />
                          {/if}
                        </Button>
                      {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content sideOffset={4}>{hidden ? 'Show resource' : 'Hide resource'}</Tooltip.Content>
                  </Tooltip.Root>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </Tooltip.Provider>
    </ScrollArea>

    <Dialog.Footer class="border-t border-border px-4 py-3">
      <Button variant="secondary" onclick={onClose}>Cancel</Button>
      <Button onclick={handleSave}>Save Mapping</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
