export type ConfirmDialogState = {
  open: boolean;
  title: string;
  body: string;
  resolve: ((ok: boolean) => void) | null;
};

export function useConfirm() {
  let confirmDialog: ConfirmDialogState = $state({ open: false, title: '', body: '', resolve: null });

  function showConfirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmDialog = { open: true, title, body, resolve };
    });
  }

  function handleConfirmChoice(ok: boolean): void {
    confirmDialog.open = false;
    confirmDialog.resolve?.(ok);
    confirmDialog.resolve = null;
  }

  return {
    get confirmDialog(): ConfirmDialogState {
      return confirmDialog;
    },
    showConfirm,
    handleConfirmChoice,
  };
}
