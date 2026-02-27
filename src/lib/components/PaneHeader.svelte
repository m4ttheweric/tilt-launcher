<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';

  interface Props {
    title: string;
    class?: string;
    actions?: Snippet;
  }

  let { title, class: className, actions }: Props = $props();
</script>

<div
  class={cn(
    'grid h-6 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-muted/50 px-2 text-[11px] leading-none text-muted-foreground',
    className,
  )}
>
  <p class="truncate pr-2">{title}</p>
  <div class="flex h-full items-center">
    {@render actions?.()}
  </div>
</div>
