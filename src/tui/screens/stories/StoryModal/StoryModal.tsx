import { useContext, useState } from "react";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type FormField, type FormModalDelete, type FormValues, Modal } from "../../../components/index.js";
import { ShellContext } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { StoryModalBody, type StoryModalConfirm } from "../StoryModalBody/index.js";

/**
 * Edits one Story in a screen Modal with two tabs, for a project that has Specs on: General has the Story
 * form, and Specs has the specs of the Story. `esc` and the `✕` close the Modal; with unsaved changes, they
 * first ask before the changes are discarded.
 */
export function StoryModal({
  ctx,
  storyId,
  title,
  fields,
  initialValues,
  onSubmit,
  onClose,
  onDelete,
}: {
  ctx: ServiceContext;
  storyId: string;
  title: string;
  fields: readonly FormField[];
  initialValues: FormValues;
  /** May throw: a `ValidationError` shows its issues under the fields, any other error becomes a toast. */
  onSubmit(values: FormValues): void | Promise<void>;
  onClose(): void;
  onDelete: FormModalDelete;
}) {
  const shell = useContext(ShellContext);
  const [hints, setHints] = useState<readonly KeyHint[]>([]);
  const [confirming, setConfirming] = useState<StoryModalConfirm>(null);
  const close = () => {
    if (shell.isDirty()) setConfirming("discard");
    else onClose();
  };
  return (
    <Modal title={title} size="screen" flush hints={hints} onClose={confirming === null ? close : undefined}>
      <StoryModalBody
        ctx={ctx}
        storyId={storyId}
        fields={fields}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onClose={onClose}
        onRequestClose={close}
        onDelete={onDelete}
        confirming={confirming}
        onConfirming={setConfirming}
        onHints={setHints}
      />
    </Modal>
  );
}
