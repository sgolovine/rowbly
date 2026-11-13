import { useInput } from "ink";
import { useEffect, useState } from "react";
import { type Attachment, listAttachments } from "../../../../services/attachment/attachment.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useCovered } from "../../../components/index.js";
import { type AsyncState, type Layout, useAsync, useIsActive, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { type AttachmentsTabEnv, type AttachmentTask, handleKey } from "./attachments-tab-actions.js";

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

/** The state of the Attachments tab that its render reads. */
export interface AttachmentsTabState {
  readonly env: AttachmentsTabEnv;
  readonly state: AsyncState<Attachment[]>;
  readonly layout: Layout;
  readonly items: readonly Attachment[];
  readonly task: AttachmentTask;
  /** The tab has the keys, and asks no question. */
  readonly idle: boolean;
}

/** The list, the selection, the question and the keys of the Attachments tab. */
export function useAttachmentsTab({
  ctx,
  storyId,
  selected,
  onHints,
  onTask,
}: AttachmentsTabProps): AttachmentsTabState {
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

  return { env, state, layout, items, task, idle };
}
