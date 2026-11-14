import { ConfirmDialog, type FormModalDelete } from "../../../components/index.js";

/** Which confirmation is on top of the Story form. */
export type StoryConfirm = "delete" | null;

export interface StoryConfirmDialogsProps {
  readonly confirming: StoryConfirm;
  readonly onDelete: FormModalDelete;
  readonly onConfirming: (confirm: StoryConfirm) => void;
}

/** The confirmation on top of the Story form: delete the Story. */
export function StoryConfirmDialogs({ confirming, onDelete, onConfirming }: StoryConfirmDialogsProps) {
  return (
    confirming === "delete" && (
      <ConfirmDialog
        title={onDelete.title}
        message={onDelete.message}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => confirmDelete(onDelete, onConfirming)}
        onCancel={() => onConfirming(null)}
      />
    )
  );
}

/** Closes the confirmation, then deletes the Story. */
function confirmDelete(onDelete: FormModalDelete, onConfirming: (confirm: StoryConfirm) => void): void {
  onConfirming(null);
  onDelete.onConfirm();
}
