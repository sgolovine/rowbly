import { Box } from "ink";
import { ConversationView, conversationKeys, Modal, modalSize } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { THREAD_DETAIL_ROWS, ThreadDetail, threadName } from "../../stories/index.js";
import { type ThreadModalProps, useThreadModal } from "./use-thread-modal.js";

/** Below this body height, the Modal shows the compact detail, so that the conversation keeps its room. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 10;

/** The keys of the Modal: the keys of the conversation, then `esc`. */
function modalHints(live: boolean): readonly KeyHint[] {
  return [...conversationKeys(live), { key: "esc", description: "close" }];
}

/** The rows of the conversation: the body less the detail and one blank row. */
function conversationHeight(body: number | undefined, compact: boolean): number | undefined {
  return body === undefined ? undefined : Math.max(2, body - (compact ? 2 : THREAD_DETAIL_ROWS) - 1);
}

/**
 * The Thread Modal of the Factory view, with the title `<story-id> › <thread name>`. It shows the metadata of the
 * Thread, then its conversation, which follows the new entries while the Thread runs. It is read-only. `esc` or
 * the `✕` closes it.
 */
export function ThreadModal(props: ThreadModalProps) {
  const { ctx, stages, onClose } = props;
  const { active, current, now, layout } = useThreadModal(props);
  const live = current.status === "running";
  const body = modalSize(layout, { footer: true }).body;
  const compact = body.height !== undefined && body.height < FULL_DETAIL_MIN_HEIGHT;

  return (
    <Modal
      title={`${current.storyId ?? "—"} › ${threadName(current, stages)}`}
      hints={modalHints(live)}
      onClose={onClose}
    >
      <ThreadDetail thread={current} now={now} compact={compact} />
      <Box marginTop={1}>
        <ConversationView
          ctx={ctx}
          threadId={current.id}
          live={live}
          active={active}
          width={body.width}
          height={conversationHeight(body.height, compact)}
        />
      </Box>
    </Modal>
  );
}
