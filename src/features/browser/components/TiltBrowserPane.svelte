<script lang="ts">
  import type { Environment } from '$lib/types.ts';
  import { Button } from '$lib/components/ui/button/index.js';
  import PaneHeader from '$lib/components/PaneHeader.svelte';
  import X from '@lucide/svelte/icons/x';

  type TiltWebview = HTMLElement & { executeJavaScript?: (code: string) => Promise<unknown> };

  interface Props {
    selectedEnv: Environment | null;
    selectedEnvStatus: string;
    selectedTiltUrl: string;
    tiltZoomFactor: number;
    onStart: (env: Environment) => void | Promise<void>;
    onRetry: () => void;
    onZoomOut: () => void | Promise<void>;
    onZoomIn: () => void | Promise<void>;
    onResetZoom: () => void | Promise<void>;
    onClose: () => void;
    onWebviewRef: (webview: TiltWebview | null) => void;
    onDidFinishLoad: () => void | Promise<void>;
  }

  let {
    selectedEnv,
    selectedEnvStatus,
    selectedTiltUrl,
    tiltZoomFactor,
    onStart,
    onRetry,
    onZoomOut,
    onZoomIn,
    onResetZoom,
    onClose,
    onWebviewRef,
    onDidFinishLoad,
  }: Props = $props();

  let tiltWebview: TiltWebview | null = $state(null);

  $effect(() => {
    onWebviewRef(tiltWebview);
  });
</script>

<div class="flex min-h-0 flex-col overflow-hidden bg-background">
  <PaneHeader title={selectedEnv ? `${selectedEnv.name} · ${selectedEnv.tiltfile}` : 'Tilt Dashboard'}>
    {#snippet actions()}
      <div class="flex items-center gap-0.5 pr-1">
        <button
          type="button"
          class="inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded px-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Zoom out embedded tilt pane"
          onclick={() => void onZoomOut()}
          disabled={!selectedTiltUrl}
        >
          −
        </button>
        <button
          type="button"
          class="inline-flex h-5 min-w-11 cursor-pointer items-center justify-center rounded px-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Reset embedded tilt pane zoom"
          onclick={() => void onResetZoom()}
          disabled={!selectedTiltUrl}
        >
          {Math.round(tiltZoomFactor * 100)}%
        </button>
        <button
          type="button"
          class="inline-flex h-5 min-w-5 cursor-pointer items-center justify-center rounded px-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Zoom in embedded tilt pane"
          onclick={() => void onZoomIn()}
          disabled={!selectedTiltUrl}
        >
          +
        </button>
      </div>
      <button
        type="button"
        class="inline-flex h-5 w-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Close embedded tilt pane"
        onclick={onClose}
      >
        <X class="h-3.5 w-3.5" />
      </button>
    {/snippet}
  </PaneHeader>
  {#if !selectedEnv}
    <div class="grid h-full place-items-center text-xs text-muted-foreground">
      Select an environment to view its embedded Tilt dashboard.
    </div>
  {:else if selectedEnvStatus !== 'running'}
    <div class="grid h-full place-items-center px-6 text-center">
      <div class="max-w-md space-y-3">
        <p class="text-sm font-medium text-foreground">Tilt dashboard unavailable</p>
        <p class="text-xs text-muted-foreground">
          {selectedEnv.name} is currently <span class="font-semibold capitalize">{selectedEnvStatus}</span>. Start the
          environment to load its dashboard in this pane.
        </p>
        <div class="flex items-center justify-center gap-2">
          <Button
            size="sm"
            onclick={() => void onStart(selectedEnv)}
            disabled={selectedEnvStatus === 'starting' || selectedEnvStatus === 'running'}
            >{selectedEnvStatus === 'starting' ? 'Starting...' : `Start ${selectedEnv.name}`}</Button
          >
          <Button size="sm" variant="secondary" onclick={onRetry}>Retry</Button>
        </div>
      </div>
    </div>
  {:else if selectedTiltUrl}
    <webview
      bind:this={tiltWebview}
      src={selectedTiltUrl}
      class="h-full w-full overflow-hidden"
      ondid-finish-load={() => void onDidFinishLoad()}
    ></webview>
  {:else}
    <div class="grid h-full place-items-center text-xs text-muted-foreground">
      Click a button above to open the Tilt dashboard.
    </div>
  {/if}
</div>
