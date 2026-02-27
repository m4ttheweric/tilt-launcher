<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { classifyTiltfilePath, getHomeDir, readDir } from '$lib/api.ts';
  import type { DirEntry } from '$lib/types.ts';
  import Folder from '@lucide/svelte/icons/folder';
  import FileText from '@lucide/svelte/icons/file-text';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';

  import Link2 from '@lucide/svelte/icons/file-symlink';

  let {
    onpick,
  }: {
    onpick: (path: string, isSymlink: boolean) => void;
  } = $props();

  let inputEl: HTMLInputElement | null = $state(null);
  let listEl: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (activeIndex < 0 || !listEl) return;
    const item = listEl.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  });
  let inputValue = $state('');
  let homePath = $state('');
  let allEntries: DirEntry[] = $state([]);
  let activeIndex = $state(-1);
  let open = $state(false);
  let loading = $state(false);
  let invalid = $state(false);
  let invalidMsg = $state('');
  let dirError = $state('');
  let pickedRealPath = $state(''); // original file location when symlink was picked (real path)

  // Cache directory listings for the lifetime of this component so revisits
  // are instant and arrow navigation is never blocked by an IPC round-trip.
  const dirCache = new SvelteMap<string, DirEntry[]>();

  /** Replace the home prefix with ~/. Used for paths returned from IPC (real absolute paths). */
  function display(path: string): string {
    if (homePath && path.startsWith(homePath)) return '~' + path.slice(homePath.length);
    return path;
  }

  // inputValue carries ~/… form directly — the backend expands ~ before any fs calls.
  const lastSlash = $derived(inputValue.lastIndexOf('/'));
  const listDir = $derived(lastSlash >= 0 ? inputValue.slice(0, lastSlash + 1) : '');
  const filterText = $derived(lastSlash >= 0 ? inputValue.slice(lastSlash + 1) : inputValue);

  const PARENT: DirEntry = { name: '..', isDirectory: true, isFile: false, isSymlink: false };

  const filteredEntries = $derived(
    allEntries.filter((e) => {
      const f = filterText.toLowerCase();
      if (f && !e.name.toLowerCase().startsWith(f)) return false;
      return e.isDirectory || /^Tiltfile/i.test(e.name);
    }),
  );

  const displayEntries = $derived([...(listDir.length > 1 ? [PARENT] : []), ...filteredEntries]);

  $effect(() => {
    const dir = listDir;
    if (!dir) return;

    dirError = '';

    // Serve from cache immediately — no IPC, no lag, no activeIndex disruption.
    const cached = dirCache.get(dir);
    if (cached !== undefined) {
      allEntries = cached;
      loading = false;
      return;
    }

    // First visit: clear stale entries and fetch.
    allEntries = [];
    loading = true;
    let cancelled = false;

    void readDir(dir).then((result) => {
      if (cancelled) return;
      loading = false;
      if (result.ok) {
        dirCache.set(dir, result.entries);
        allEntries = result.entries;
        // Do NOT reset activeIndex here — the user may have started navigating
        // with arrow keys while the IPC call was in flight.
      } else {
        dirError = result.error ?? 'Cannot read directory';
      }
    });

    return () => {
      cancelled = true;
    };
  });

  function isTiltfile(entry: DirEntry): boolean {
    return /^Tiltfile/i.test(entry.name);
  }

  function navigateUp(): void {
    const stripped = listDir.endsWith('/') ? listDir.slice(0, -1) : listDir;
    const idx = stripped.lastIndexOf('/');
    // Don't ascend above '~/' when browsing from home
    inputValue = idx > 0 ? stripped.slice(0, idx + 1) : '/';
    activeIndex = 1; // 0 is the '..' parent entry
  }

  function selectEntry(entry: DirEntry): void {
    invalid = false;
    invalidMsg = '';
    if (entry.name === '..') {
      navigateUp();
      return;
    }
    if (entry.isDirectory) {
      inputValue = listDir + entry.name + '/';
      activeIndex = 1; // 0 is the '..' parent entry
      inputEl?.focus();
      return;
    }
    if (isTiltfile(entry)) {
      const picked = listDir + entry.name; // ~/… form
      open = false;
      activeIndex = -1;

      if (entry.isSymlink && entry.realPath) {
        // Entry is already known to be a symlink — use data from the directory
        // listing directly, no extra IPC needed.
        inputValue = picked; // symlink location (~/… form)
        pickedRealPath = entry.realPath; // real path returned by fs (absolute)
        onpick(picked, true);
      } else {
        // Not a symlink as listed — run a reverse scan in case the user navigated
        // to the real file while a symlink exists somewhere else.
        inputValue = picked;
        pickedRealPath = '';
        void classifyTiltfilePath(picked).then((result) => {
          inputValue = display(result.path);
          if (result.isSymlink && result.realPath) {
            pickedRealPath = result.realPath;
          }
          onpick(result.path, result.isSymlink);
        });
      }
      return;
    }
    triggerInvalid('Select a Tiltfile or navigate into a directory');
  }

  function confirmTyped(): void {
    if (!filterText) {
      triggerInvalid('Enter a filename or select from the list');
      return;
    }
    const exact = allEntries.find((e) => e.name === filterText);
    if (exact) {
      selectEntry(exact);
    } else {
      triggerInvalid('No matching Tiltfile found in this directory');
    }
  }

  function triggerInvalid(msg: string): void {
    invalidMsg = msg;
    invalid = true;
    setTimeout(() => {
      invalid = false;
    }, 600);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        open = true;
        activeIndex = 0;
        return;
      }
      activeIndex = Math.min(activeIndex + 1, displayEntries.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIndex <= 0) {
        activeIndex = -1;
        open = false;
        return;
      }
      activeIndex--;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0) {
        const entry = displayEntries[activeIndex];
        if (entry) selectEntry(entry);
      } else {
        confirmTyped();
      }
    } else if (e.key === 'Tab' && open && activeIndex >= 0) {
      const entry = displayEntries[activeIndex];
      if (entry?.isDirectory) {
        e.preventDefault();
        selectEntry(entry);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        open = false;
        activeIndex = -1;
      }
    }
  }

  onMount(async () => {
    const home = await getHomeDir();
    homePath = home;
    if (!inputValue) inputValue = '~/';
  });
</script>

<div>
  <!-- Input + dropdown anchored together -->
  <div class="relative">
    <div
      class={`border font-mono text-sm ${invalid ? 'animate-shake border-rose-500' : dirError ? 'border-amber-500/60' : 'border-input'}`}
    >
      <input
        bind:this={inputEl}
        value={inputValue}
        class="w-full bg-background px-3 py-1.5 font-mono text-sm outline-none"
        placeholder="~/path/to/your/Tiltfile"
        oninput={(e) => {
          inputValue = e.currentTarget.value;
          open = true;
          // Auto-select the first real item (skip '..' so Enter confirms a match, not navigates up)
          const firstReal =
            displayEntries[0]?.name === '..'
              ? displayEntries.length > 1
                ? 1
                : -1
              : displayEntries.length > 0
                ? 0
                : -1;
          activeIndex = firstReal;
          invalid = false;
          pickedRealPath = '';
        }}
        onfocus={() => {
          open = true;
        }}
        onblur={() => {
          setTimeout(() => {
            open = false;
          }, 150);
        }}
        onkeydown={onKeyDown}
      />
    </div>

    <!-- Dropdown anchored to the input, unaffected by content below -->
    {#if open && (displayEntries.length > 0 || loading)}
      <div
        bind:this={listEl}
        class="absolute top-full right-0 left-0 z-[70] max-h-64 overflow-y-auto border border-border bg-popover shadow-lg"
      >
        {#if loading && displayEntries.length === 0}
          <div class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span
              class="inline-block h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-foreground"
            ></span>
            Loading…
          </div>
        {:else}
          {#each displayEntries as entry, i (entry.name)}
            {@const isParent = entry.name === '..'}
            {@const isDir = entry.isDirectory && !isParent}
            {@const pathHint = isParent
              ? 'Parent directory'
              : entry.isDirectory
                ? `${listDir}${entry.name}/`
                : `${listDir}${entry.name}`}
            <button
              type="button"
              class={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === activeIndex ? 'bg-muted' : ''}`}
              onmouseenter={() => (activeIndex = i)}
              onmousedown={(e) => {
                e.preventDefault();
                selectEntry(entry);
              }}
            >
              <!-- Left icon -->
              {#if isParent}
                <ArrowUp class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {:else if isDir}
                <Folder class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {:else}
                <FileText class="h-3.5 w-3.5 shrink-0 text-primary" />
              {/if}

              <!-- Name -->
              <span class={`flex-1 truncate font-mono text-xs ${isParent ? 'text-muted-foreground italic' : ''}`}>
                {entry.name}{isDir ? '/' : ''}
              </span>

              <!-- Symlink badge -->
              {#if entry.isSymlink}
                <Link2 class="h-3 w-3 shrink-0 text-muted-foreground" />
              {/if}

              <!-- Right path hint -->
              <span class="ml-2 max-w-[220px] shrink-0 truncate font-mono text-[10px] text-muted-foreground/60">
                {pathHint}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
  <!-- end relative input+dropdown wrapper -->

  <!-- Feedback — flush against the input border, no gap -->
  {#if invalid && invalidMsg}
    <p class="border border-t-0 border-rose-500/40 bg-rose-500/5 px-2.5 py-1 text-[11px] text-rose-400">
      {invalidMsg}
    </p>
  {:else if dirError}
    <p class="border border-t-0 border-amber-500/40 bg-amber-500/5 px-2.5 py-1 text-[11px] text-amber-400">
      {dirError}
    </p>
  {:else if pickedRealPath}
    <div
      class="flex items-center gap-2 border border-t-0 border-border/40 bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground/70"
    >
      <Link2 class="h-3 w-3 shrink-0" />
      <span class="shrink-0 text-muted-foreground/50">symlink</span>
      <span class="truncate font-mono" title={display(pickedRealPath)}>{display(pickedRealPath)}</span>
    </div>
  {/if}
</div>
