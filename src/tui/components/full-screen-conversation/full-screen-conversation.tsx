import { type Key, useInput } from "ink";
import type { openConversation } from "../../../services/conversation/conversation.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { useIsActive, useKeyCapture, useLayout } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { ConversationView, conversationKeys } from "../conversation-view/index.js";
import { Modal, modalSize } from "../modal/index.js";

export interface FullScreenConversationProps {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  /** The thread runs: new entries can arrive, and the view follows them. */
  readonly live: boolean;
  /** Shown in the top edge of the border. */
  readonly title: string;
  /** `ctrl+f`, `esc` or the `✕` closes the view. */
  onClose(): void;
  /** Opens the conversation; tests replace it. */
  readonly open?: typeof openConversation;
}

/** The keys of the view: the keys of the conversation, then the keys that close it. */
function fullScreenHints(live: boolean): readonly KeyHint[] {
  return [...conversationKeys(live), { key: "ctrl+f/esc", description: "close" }];
}

/** `esc` and `ctrl+f` close the view. The conversation takes the other keys. */
function handleCloseKey(onClose: () => void, input: string, key: Key): void {
  if (key.escape || (key.ctrl && input === "f")) {
    onClose();
  }
}

/**
 * The conversation of one thread in a Modal as large as the area that it covers, read-only. It has the keys and
 * the wheel of a `ConversationView`, and it follows the new entries while the thread runs. `esc`, `ctrl+f` and the
 * `✕` in its border close it.
 */
export function FullScreenConversation({ ctx, threadId, live, title, onClose, open }: FullScreenConversationProps) {
  const outer = useLayout();
  const active = useIsActive();
  const { body } = modalSize(outer, { size: "screen", maxWidth: outer.width, footer: true });

  // The shell leaves `esc` to the view, so that the screen below does not go back.
  useKeyCapture(active, { text: false, escape: true });
  useInput((input, key) => handleCloseKey(onClose, input, key), { isActive: active });

  return (
    <Modal title={title} hints={fullScreenHints(live)} size="screen" maxWidth={outer.width} onClose={onClose}>
      <ConversationView
        ctx={ctx}
        threadId={threadId}
        live={live}
        active={active}
        width={body.width}
        height={body.height}
        open={open}
      />
    </Modal>
  );
}
