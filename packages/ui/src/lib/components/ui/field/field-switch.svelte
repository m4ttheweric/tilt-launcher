<script lang="ts">
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { cn } from '$lib/utils.js';
  import type { ComponentProps } from 'svelte';

  let { ref = $bindable(null), class: className, ...restProps }: ComponentProps<typeof Switch> = $props();
</script>

<Switch bind:ref data-slot="field-switch" class={cn('shrink-0', className)} {...restProps} />
