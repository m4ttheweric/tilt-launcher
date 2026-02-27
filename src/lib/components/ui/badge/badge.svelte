<script lang="ts" module>
  import { type VariantProps, tv } from 'tailwind-variants';

  export const badgeVariants = tv({
    base: 'inline-flex h-4 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-0 text-[10px] font-medium whitespace-nowrap leading-none [&>svg]:pointer-events-none [&>svg]:size-3',
    variants: {
      variant: {
        default: 'border-transparent bg-primary/20 text-primary',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        destructive: 'border-transparent bg-destructive/20 text-destructive',
        outline: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  });

  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    href,
    class: className,
    variant = 'default',
    children,
    ...restProps
  }: WithElementRef<HTMLAnchorAttributes> & {
    variant?: BadgeVariant;
  } = $props();
</script>

<svelte:element
  this={href ? 'a' : 'span'}
  bind:this={ref}
  data-slot="badge"
  {href}
  class={cn(badgeVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
