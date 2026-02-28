<script lang="ts">
  import { Tabs as TabsPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    variant = 'default',
    ...restProps
  }: TabsPrimitive.TriggerProps & { variant?: 'default' | 'minimal' } = $props();

  const variants = {
    default:
      "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:shadow-sm dark:text-muted-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    minimal:
      "inline-flex items-center justify-center rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/60 data-[state=active]:bg-muted data-[state=active]:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  };
</script>

<TabsPrimitive.Trigger bind:ref data-slot="tabs-trigger" class={cn(variants[variant], className)} {...restProps} />
