<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'default',
    ...restProps
  }: TabsPrimitive.ListProps & { variant?: 'default' | 'minimal' } = $props();

  const variants = {
    default: 'inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground',
    minimal: 'inline-flex h-6 w-fit items-center gap-0 border-b border-border bg-muted/50 text-muted-foreground',
  };
</script>

<TabsPrimitive.List
  bind:ref
  data-slot="tabs-list"
  data-variant={variant}
  class={cn(variants[variant], className)}
  {...restProps}
/>
