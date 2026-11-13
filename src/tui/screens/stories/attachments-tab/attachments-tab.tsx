import { Box, useInput } from "ink";
import { useEffect, useState } from "react";
import { type Attachment, listAttachments } from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, FormModal, useCovered } from "../../../components/index.js";
import { useAsync, useIsActive, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { AttachmentList } from "../attachment-list/index.js";
import {
  type AttachmentsTabEnv,
  type AttachmentTask,
  attachFile,
  confirmRemove,
  handleKey,
  openItem,
} from "./attachments-tab-actions.js";

const HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "n", description: "new PNG" },
  { key: "o", description: "open" },
  { key: "d", description: "remove" },
];

export interface AttachmentsTabProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** This tab is the tab on the screen, and takes the keys. */
  readonly selected: boolean;
  onHints(hints: readonly KeyHint[]): void;
  /** The tab asks a question, so that the Modal leaves `esc` and the save key to it. */
  onTask(value: boolean): void;
}

/** The rows of the list: the layout height less the Buttons and the blank row above them. */
function listHeight(height: number | undefined): number | undefined {
  return height === undefined ? undefined : Math.max(1, height - 2);
}

/**
 * The saved images of one Story. The arrows select an image, `n` attaches a PNG from a path, `o` opens the
 * selected image and `d` asks before it removes the image. The list reads again when the tab is selected.
 */
export function AttachmentsTab({ ctx, storyId, selected, onHints, onTask }: AttachmentsTabProps) {
  const active = useIsActive();
  const covered = useCovered();
  const toast = useToast();
  const layout = useLayout();
  const [task, setTask] = useState<AttachmentTask>(null);
  const [cursor, setCursor] = useState(0);
  const state = useAsync(() => listAttachments({ story: storyId }, ctx), [ctx, storyId, selected]);

  const items: readonly Attachment[] = state.data ?? [];
  const item = items[Math.min(cursor, items.length - 1)];
  const idle = active && selected && !covered && task === null;
  const env: AttachmentsTabEnv = {
    ctx,
    storyId,
    toast,
    count: items.length,
    item,
    setTask,
    setCursor,
    reload: state.reload,
  };

  useEffect(() => onHints(HINTS), [onHints]);
  useEffect(() => {
    onTask(task !== null);

    return () => onTask(false);
  }, [task, onTask]);
  useInput((input, key) => handleKey(env, input, key), { isActive: idle });

  return (
    <Box flexDirection="column" height={layout.height}>
      <AttachmentList
        items={items}
        item={item}
        active={idle}
        loading={state.loading}
        height={listHeight(layout.height)}
        onSelect={setCursor}
      />
      <Box gap={2} marginTop={1}>
        <Button compact label="New PNG" keyName="n" onClick={() => setTask("path")} clickable={idle} />
        <Button compact label="Open" keyName="o" onClick={() => openItem(env)} clickable={idle && !!item} />
        <Button
          compact
          label="Remove"
          keyName="d"
          onClick={() => setTask("remove")}
          clickable={idle && !!item}
          destructive
        />
      </Box>
      {task === "path" && (
        <FormModal
          title="Attach PNG"
          fields={[{ name: "path", label: "PNG path", kind: "text", required: true }]}
          initialValues={{ path: "" }}
          onClose={() => setTask(null)}
          submitOnEnter
          onSubmit={(values) => attachFile(env, values)}
        />
      )}
      {task === "remove" && item && (
        <ConfirmDialog
          title="Remove attachment"
          message={`Remove ${item.name}?`}
          destructive
          confirmLabel="Remove"
          cancelLabel="Keep"
          onCancel={() => setTask(null)}
          onConfirm={() => confirmRemove(env, item)}
        />
      )}
    </Box>
  );
}
