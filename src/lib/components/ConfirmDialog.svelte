<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  interface Props {
    open: boolean;
    title: string;
    body: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { open, title, body, onConfirm, onCancel }: Props = $props();
</script>

<Dialog.Root
  {open}
  onOpenChange={(nextOpen) => {
    if (!nextOpen) onCancel();
  }}
>
  <Dialog.Content showCloseButton={false} class="max-w-sm gap-0 p-0">
    <div class="px-6 pt-6 pb-4">
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description class="text-xs whitespace-pre-wrap">{body}</Dialog.Description>
      </Dialog.Header>
    </div>
    <Dialog.Footer class="border-t border-border px-6 py-3">
      <Button variant="secondary" onclick={onCancel}>Cancel</Button>
      <Button onclick={onConfirm}>Continue</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
