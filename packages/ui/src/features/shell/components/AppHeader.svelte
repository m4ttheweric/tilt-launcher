<script lang="ts">
  import Monitor from '@lucide/svelte/icons/monitor';
  import Moon from '@lucide/svelte/icons/moon';
  import Settings from '@lucide/svelte/icons/settings';
  import Sun from '@lucide/svelte/icons/sun';

  interface Props {
    message: string;
    messageKind: 'success' | 'error' | '';
    themeMode: 'dark' | 'light' | 'system';
    onCycleThemeMode: () => void | Promise<void>;
    onOpenSettings: () => void;
  }

  let { message, messageKind, themeMode, onCycleThemeMode, onOpenSettings }: Props = $props();
</script>

<header data-tauri-drag-region class="drag-region flex h-10 shrink-0 items-center justify-between border-b border-border pr-2 pl-20">
  <div class="pointer-events-none flex items-center gap-2">
    <h1 class="text-sm leading-none font-semibold">Tilt Launcher</h1>
    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">v{__APP_VERSION__}</span>
  </div>
  <div class="pointer-events-none flex items-center gap-2">
    {#if message}
      <span class={`text-xs ${messageKind === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>{message}</span>
    {/if}
    <button
      type="button"
      class="no-drag pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Toggle theme mode"
      title={`Theme: ${themeMode}`}
      onclick={() => void onCycleThemeMode()}
    >
      {#if themeMode === 'dark'}
        <Moon class="h-3.5 w-3.5" />
      {:else if themeMode === 'light'}
        <Sun class="h-3.5 w-3.5" />
      {:else}
        <Monitor class="h-3.5 w-3.5" />
      {/if}
    </button>
    <button
      type="button"
      class="no-drag pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Open settings"
      onclick={onOpenSettings}
    >
      <Settings class="h-3.5 w-3.5" />
    </button>
  </div>
</header>
