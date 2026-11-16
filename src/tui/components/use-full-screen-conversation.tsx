import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useId, useMemo, useState } from "react";
import type { ServiceContext } from "../../services/workspace/workspace.js";
import { useMainOverlay } from "../hooks/index.js";
import { FullScreenConversation } from "./full-screen-conversation/index.js";

export interface FullScreenConversationOptions {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  /** The thread runs: new entries can arrive. */
  readonly live: boolean;
  /** Shown in the top edge of the border. */
  readonly title: string;
}

export interface FullScreenConversationControl {
  /** Opens the conversation over the whole terminal. */
  open(): void;
  /** Whether it is open; the opener takes no keys and no wheel meanwhile. */
  readonly isOpen: boolean;
  /** The view to render where the opener is, outside the shell, where there is nothing to cover; otherwise null. */
  readonly inline: ReactNode;
}

/** The view while it is open. It is built again when the thread or its status changes, and keeps its state. */
function conversationNode(
  isOpen: boolean,
  options: FullScreenConversationOptions,
  setOpen: Dispatch<SetStateAction<boolean>>,
): ReactNode {
  if (!isOpen) {
    return null;
  }

  return (
    <FullScreenConversation
      key={options.threadId}
      ctx={options.ctx}
      threadId={options.threadId}
      live={options.live}
      title={options.title}
      onClose={() => setOpen(false)}
    />
  );
}

/**
 * Opens a `FullScreenConversation` of one thread over the whole terminal, above the screens and the shell, as
 * `useFullScreenEditor` opens an editor. The view starts at the newest entries.
 */
export function useFullScreenConversation(options: FullScreenConversationOptions): FullScreenConversationControl {
  const { ctx, threadId, live, title } = options;
  const overlay = useMainOverlay();
  const id = useId();
  const [isOpen, setOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the fields of `options` start a new node, not the object.
  const node = useMemo(() => conversationNode(isOpen, options, setOpen), [isOpen, ctx, threadId, live, title]);

  useEffect(() => {
    if (!node || !overlay) {
      return;
    }

    overlay.open(id, node);

    return () => overlay.close(id);
  }, [node, overlay, id]);

  return { open: () => setOpen(true), isOpen, inline: overlay ? null : node };
}
