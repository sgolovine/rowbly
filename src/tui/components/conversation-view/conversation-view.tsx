import { Box, type DOMElement, Text, useInput } from "ink";
import { useEffect, useRef } from "react";
import { openConversation } from "../../../services/conversation/conversation.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { useIsActive, useMouse, WHEEL_LINES } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { ConversationEntry } from "../conversation-entry/index.js";
import { ConversationNotice } from "../conversation-notice/index.js";
import { handleConversationKey, scrollBy, type ViewEnv } from "./conversation-keys.js";
import { loadOlder } from "./conversation-reads.js";
import { shownParts, statusText, viewport } from "./conversation-window.js";
import { useConversationWindow } from "./use-conversation-window.js";

export { conversationKeys } from "./conversation-keys.js";

interface ConversationViewProps {
  ctx: ServiceContext;
  threadId: string;
  /** The thread runs: new entries can arrive. */
  live: boolean;
  /** The view takes the keys and the wheel. */
  active: boolean;
  width: number;
  /** The rows of the view with its status row. Without it, all rows of the window show. */
  height?: number;
  /** Opens the conversation; tests replace it. */
  open?: typeof openConversation;
}

/**
 * A read-only view of the Pi conversation of one thread. It opens only the file of that thread, reads pages of
 * 20 entries and keeps at most three pages. It reads older pages when the view reaches the top, and newer pages
 * when it reaches the end. It never starts an agent. Each entry shows its label and time, the text, the tool
 * calls and the tool results. While the thread runs (`live`), the view follows the new entries. A scroll up
 * stops this, so the history stays in place; `end` or `f` follows again. `↑/↓`, `pgup/pgdn`, the wheel and
 * `home/end` scroll. When the view closes or the thread changes, the conversation, its index and its watch close.
 */
export function ConversationView({
  ctx,
  threadId,
  live,
  active,
  width,
  height,
  open = openConversation,
}: ConversationViewProps) {
  const keys = useIsActive() && active;
  const state = useConversationWindow({ ctx, threadId, live, width, open });
  const ref = useRef<DOMElement>(null);

  const { view, follow, blocks } = state;
  const port = viewport(blocks, height, state.offset);
  const env: ViewEnv = { ...state.env, view, port, live, follow, setFollow: state.setFollow };

  // The top of the window is in view: read the page before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a read starts only when the view reaches the top.
  useEffect(() => {
    if (height !== undefined && port.start === 0 && view.older && view.status === "ok") {
      void loadOlder(env);
    }
  }, [port.start, view.older, view.status, height]);
  useInput((input, key) => handleConversationKey(env, input, key), { isActive: keys });
  useMouse(ref, { onWheel: (direction) => scrollBy(env, direction * WHEEL_LINES) }, keys);

  if (view.status !== "ok") {
    return <ConversationNotice status={view.status} error={view.error} />;
  }

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      {shownParts(blocks, port).map((part) => (
        <ConversationEntry key={part.id} lines={part.lines} />
      ))}
      {height !== undefined && port.total < port.rows && <Box height={port.rows - port.total} />}
      <Text color={theme.inkFaint} wrap="truncate-end">
        {statusText(view, port, live, follow)}
      </Text>
    </Box>
  );
}
