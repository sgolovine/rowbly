import { ConfirmDialog, type FormModalDelete } from "../../../components/index.js";

/** Which confirmation is on top of the Story Modal. */
export type StoryConfirm = "discard" | "delete" | null;

export interface StoryConfirmDialogsProps {
  readonly confirming: StoryConfirm;
  readonly onDelete: FormModalDelete;
  /** Closes the Modal now, without the unsaved changes. */
  readonly onClose: () => void;
  readonly onConfirming: (confirm: StoryConfirm) => void;
}

/** The confirmation on top of the Story Modal: discard the unsaved changes, or delete the Story. */
export function StoryConfirmDialogs({ confirming, onDelete, onClose, onConfirming }: StoryConfirmDialogsProps) {
  return (
    <>
      {confirming === "discard" && (
        <ConfirmDialog
          title="Discard changes"
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={onClose}
          onCancel={() => onConfirming(null)}
        />
      )}
      {confirming === "delete" && (
        <ConfirmDialog
          title={onDelete.title}
          message={onDelete.message}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => confirmDelete(onDelete, onConfirming)}
          onCancel={() => onConfirming(null)}
        />
      )}
    </>
  );
}

/** Closes the confirmation, then deletes the Story. */
function confirmDelete(onDelete: FormModalDelete, onConfirming: (confirm: StoryConfirm) => void): void {
  onConfirming(null);
  onDelete.onConfirm();
}
