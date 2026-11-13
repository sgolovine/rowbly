import { type Dispatch, type SetStateAction, useContext, useState } from "react";
import type { PendingImage } from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type FormField, type FormModalDelete, type FormValues, Modal } from "../../../components/index.js";
import { ShellContext, type ShellRegistry } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { StoryModalBody, type StoryModalConfirm } from "../story-modal-body/index.js";

/** Closes the Modal, or asks first when the Story has unsaved text or images. */
function requestClose(
  shell: ShellRegistry,
  setConfirming: Dispatch<SetStateAction<StoryModalConfirm>>,
  onClose: () => void,
) {
  if (shell.isDirty()) {
    setConfirming("discard");

    return;
  }

  onClose();
}

/**
 * Edits one Story with General and Attachments tabs, plus Specs when the Project has Specs on.
 * `esc` and the `✕` ask before they discard unsaved text or images.
 */
export function StoryModal({
  ctx,
  storyId,
  stages,
  specs = true,
  title,
  fields,
  initialValues,
  onSubmit,
  onClose,
  onDelete,
}: {
  ctx: ServiceContext;
  storyId: string;
  /** The names of the Stages by key, for the Threads tab. */
  stages?: Readonly<Record<string, string>>;
  specs?: boolean;
  title: string;
  fields: readonly FormField[];
  initialValues: FormValues;
  /** May throw: a `ValidationError` shows its issues under the fields, any other error becomes a toast. */
  onSubmit(values: FormValues, attachments?: readonly PendingImage[]): void | Promise<void>;
  onClose(): void;
  onDelete: FormModalDelete;
}) {
  const shell = useContext(ShellContext);
  const [hints, setHints] = useState<readonly KeyHint[]>([]);
  const [confirming, setConfirming] = useState<StoryModalConfirm>(null);

  const actions = { close: () => requestClose(shell, setConfirming, onClose) };

  return (
    <Modal title={title} size="screen" flush hints={hints} onClose={confirming === null ? actions.close : undefined}>
      <StoryModalBody
        key={`${ctx.cwd}:${storyId}`}
        ctx={ctx}
        storyId={storyId}
        stages={stages}
        specs={specs}
        fields={fields}
        initialValues={initialValues}
        onSubmit={onSubmit}
        onClose={onClose}
        onRequestClose={actions.close}
        onDelete={onDelete}
        confirming={confirming}
        onConfirming={setConfirming}
        onHints={setHints}
      />
    </Modal>
  );
}
