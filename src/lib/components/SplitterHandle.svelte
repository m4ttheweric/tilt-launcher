<script lang="ts">
  interface Props {
    orientation: 'horizontal' | 'vertical';
    ariaLabel: string;
    onResizeStart: (event: MouseEvent) => void;
  }

  let { orientation, ariaLabel, onResizeStart }: Props = $props();
  const isVertical = $derived(orientation === 'vertical');
</script>

<button
  type="button"
  class={isVertical
    ? 'group relative m-0 cursor-col-resize appearance-none border-0 bg-transparent p-0 outline-none'
    : 'group relative m-0 cursor-row-resize appearance-none border-0 bg-transparent p-0 outline-none'}
  aria-label={ariaLabel}
  onmousedown={onResizeStart}
>
  {#if isVertical}
    <span class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70"></span>
    <span
      class="pointer-events-none absolute inset-y-0 left-1/2 w-[6px] -translate-x-1/2 bg-primary/20 opacity-0 transition-opacity group-hover:opacity-100"
    ></span>
  {:else}
    <span class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/70"></span>
    <span
      class="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 bg-primary/20 opacity-0 transition-opacity group-hover:opacity-100"
    ></span>
  {/if}
</button>
