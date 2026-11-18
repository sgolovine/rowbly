import { Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ThreadConnection } from "../../../../services/thread-connection/thread-connection.js";
import { theme } from "../../../theme.js";
import { abandonedText, lostText } from "../thread-host-view.js";
import { THREAD_GLYPHS, threadWaitsForNetwork } from "../thread-text.js";

/**
 * The status line of one thread: the status glyph and text (in `danger` for a failed thread), the `extra` text of the
 * caller, `waiting for network` for a thread that waits for the network, `abandoned` (with the number of `held`
 * entries when it is set) for an abandoned thread, and `connection lost (…)` in `danger` for a remote thread with a
 * lost `connection`. The thread row and the thread detail use it.
 */
export function ThreadStatusText({
  thread,
  now,
  held,
  connection,
  bold = false,
  extra,
}: {
  thread: ThreadRecord;
  /** The time for the age of a lost connection. */
  now: number;
  /** The number of held entries of an abandoned thread, when the caller read it. */
  held?: number;
  /** The lost connection of a remote thread. */
  connection?: ThreadConnection;
  /** Shows the status text in bold. */
  bold?: boolean;
  /** The muted text after the status. The caller gives its leading separator. */
  extra: string;
}) {
  const { glyph, color } = THREAD_GLYPHS[thread.status];
  const abandoned = abandonedText(thread, held);
  const lost = lostText(connection, now);

  return (
    <Text wrap="truncate-end">
      <Text color={color}>{glyph} </Text>
      <Text color={thread.status === "failed" ? theme.danger : theme.ink} bold={bold}>
        {thread.status}
      </Text>
      <Text color={theme.inkMuted}>{extra}</Text>
      {threadWaitsForNetwork(thread) && <Text color={theme.stageBoard}> · waiting for network</Text>}
      {abandoned && <Text color={theme.stageBoard}>{abandoned}</Text>}
      {lost && <Text color={theme.danger}>{lost}</Text>}
    </Text>
  );
}
