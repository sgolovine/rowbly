import { Box, useInput } from "ink";
import { type ReactNode, useContext, useState } from "react";
import { ShellContext, useEscape, useIsActive, useKeyCapture } from "../../hooks/index.js";
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
  const [confirming, setConfirming] = useState<"discard" | "delete" | null>(null);
  const close = () => {
    if (shell.isDirty()) setConfirming("discard");
    else onClose();
  };
  const idle = active && confirming === null;
  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, close);
  useInput(
    (input, key) => {
      if (key.ctrl && input === "d") setConfirming("delete");
    },
    { isActive: idle && onDelete !== undefined },
  );
  return (
    <Modal title={title} hints={onDelete ? DELETE_HINTS : undefined} onClose={idle ? close : undefined}>
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
          onConfirm={() => {
            setConfirming(null);
            onDelete.onConfirm();
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Modal>
  );
}
