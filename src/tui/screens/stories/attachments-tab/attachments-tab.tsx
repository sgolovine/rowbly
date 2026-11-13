import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import {
  type Attachment,
  addAttachment,
  listAttachments,
  openAttachment,
  removeAttachment,
} from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, FormModal, ScrollBody, SelectionRow, useCovered } from "../../../components/index.js";
import { useAsync, useIsActive, useLayout, useToast } from "../../../hooks/index.js";
import { type KeyHint, moveDelta } from "../../../keymap.js";
import { formatDateTime, theme } from "../../../theme.js";

const HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "n", description: "new PNG" },
  { key: "o", description: "open" },
  { key: "d", description: "remove" },
];
export function AttachmentsTab({
  ctx,
  storyId,
  selected,
  onHints,
  onTask,
}: {
  ctx: ServiceContext;
  storyId: string;
  selected: boolean;
  onHints(hints: readonly KeyHint[]): void;
  onTask(value: boolean): void;
}) {
  const active = useIsActive();
  const covered = useCovered();
  const toast = useToast();
  const layout = useLayout();
  const [task, setTask] = useState<"path" | "remove" | null>(null);
  const [cursor, setCursor] = useState(0);
  const state = useAsync(() => listAttachments({ story: storyId }, ctx), [ctx, storyId, selected]);
  const items: readonly Attachment[] = state.data ?? [];
  const item = items[Math.min(cursor, items.length - 1)];
  const idle = active && selected && !covered && task === null;
  useEffect(() => onHints(HINTS), [onHints]);
  useEffect(() => {
    onTask(task !== null);
    return () => onTask(false);
  }, [task, onTask]);
  const open = () => {
    if (item) {
      void openAttachment({ story: storyId, id: item.id }, ctx).catch(toast.error);
    }
  };
  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) {
        setCursor((n) => Math.max(0, Math.min(items.length - 1, n + delta)));
      } else if (input === "n") {
        setTask("path");
      } else if (input === "o") {
        open();
      } else if (input === "d" && item) {
        setTask("remove");
      }
    },
    { isActive: idle },
  );
  return (
    <Box flexDirection="column" height={layout.height}>
      <ScrollBody active={idle} height={layout.height === undefined ? undefined : Math.max(1, layout.height - 2)}>
        {!items.length && (
          <Text color={theme.inkFaint}>
            {state.loading ? "Loading attachments…" : "No attachments. Paste an image or press n to add a PNG file."}
          </Text>
        )}
        {items.map((a, i) => (
          <SelectionRow key={a.id} selected={a.id === item?.id} active={idle} onClick={() => setCursor(i)}>
            <Text color={theme.ink}>
              {a.name} · {a.size} bytes · {formatDateTime(a.createdAt)}
            </Text>
          </SelectionRow>
        ))}
      </ScrollBody>
      <Box gap={2} marginTop={1}>
        <Button compact label="New PNG" keyName="n" onClick={() => setTask("path")} clickable={idle} />
        <Button compact label="Open" keyName="o" onClick={open} clickable={idle && !!item} />
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
          onSubmit={async (values) => {
            await addAttachment({ story: storyId, file: String(values.path) }, ctx);
            setTask(null);
            state.reload();
            toast.push("info", "PNG attached");
          }}
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
          onConfirm={() => {
            setTask(null);
            void removeAttachment({ story: storyId, id: item.id }, ctx).then(() => state.reload(), toast.error);
          }}
        />
      )}
    </Box>
  );
}
