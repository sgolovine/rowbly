import { Box, type Key, useInput } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useContext, useState } from "react";
import { ShellContext, type ShellRegistry, useEscape, useIsActive, useKeyCapture } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { Button } from "../button/index.js";
import { ConfirmDialog } from "../confirm-dialog/index.js";
import { Form, type FormField, type FormValues } from "../form/index.js";
import { Modal } from "../modal/index.js";

/** The delete operation of a `FormModal` that edits a record. */
export interface FormModalDelete {
  /** The title of the confirmation, for example `Delete Story › ROW-01`. */
  title: string;
  /** The question of the confirmation, which names the record. */
  message: string;
  onConfirm(): void;
}

export interface FormModalProps {
  title: string;
  children?: ReactNode;
  extraHints?: readonly KeyHint[];
  fields: readonly FormField[];
  initialValues?: FormValues;
  /** May throw: a `ValidationError` shows its issues under the fields, any other error becomes a toast. */
  onSubmit(values: FormValues): void | Promise<void>;
  onClose(): void;
  /** `enter` on a text, number or date field submits, like `ctrl+s`, instead of moving to the next field. */
  submitOnEnter?: boolean;
  /** Shows a Delete Button below the form; it and `ctrl+d` ask before they call `onConfirm`. */
  onDelete?: FormModalDelete;
}

const DELETE_HINTS: readonly KeyHint[] = [{ key: "ctrl+d", description: "delete" }];

/** The confirmation that the modal shows over the form, if any. */
type Confirming = "discard" | "delete" | null;

type SetConfirming = Dispatch<SetStateAction<Confirming>>;

/** Closes the modal, or asks first when the form has unsaved changes. */
function closeModal(shell: ShellRegistry, setConfirming: SetConfirming, onClose: () => void): void {
  if (shell.isDirty()) {
    setConfirming("discard");

    return;
  }

  onClose();
}

function deleteKey(setConfirming: SetConfirming, input: string, key: Key): void {
  if (key.ctrl && input === "d") {
    setConfirming("delete");
  }
}

function confirmDelete(setConfirming: SetConfirming, onDelete: FormModalDelete): void {
  setConfirming(null);
  onDelete.onConfirm();
}

/**
 * A generic `Modal` that holds one `Form`, to create or edit a record. `esc` and the `✕` close it; with
 * unsaved changes, they first ask before the changes are discarded.
 */
export function FormModal({
  title,
  fields,
  initialValues,
  onSubmit,
  onClose,
  submitOnEnter,
  onDelete,
  children,
  extraHints,
}: FormModalProps) {
  const active = useIsActive();
  const shell = useContext(ShellContext);
  const [confirming, setConfirming] = useState<Confirming>(null);

  const actions = { close: () => closeModal(shell, setConfirming, onClose) };
  const idle = active && confirming === null;

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, actions.close);
  useInput((input, key) => deleteKey(setConfirming, input, key), { isActive: idle && onDelete !== undefined });

  return (
    <Modal title={title} hints={onDelete ? DELETE_HINTS : undefined} onClose={idle ? actions.close : undefined}>
      {children}
      <Form
        extraHints={extraHints}
        fields={fields}
        initialValues={initialValues}
        onSubmit={onSubmit}
        submitOnEnter={submitOnEnter}
      />
      {onDelete && (
        <Box marginTop={1}>
          <Button
            label="Delete"
            keyName="ctrl+d"
            onClick={() => setConfirming("delete")}
            clickable={idle}
            compact
            destructive
          />
        </Box>
      )}
      {confirming === "discard" && (
        <ConfirmDialog
          title="Discard changes"
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={onClose}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "delete" && onDelete && (
        <ConfirmDialog
          title={onDelete.title}
          message={onDelete.message}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => confirmDelete(setConfirming, onDelete)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Modal>
  );
}
