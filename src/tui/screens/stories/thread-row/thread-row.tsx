import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ThreadConnection } from "../../../../services/thread-connection/thread-connection.js";
import { SelectionRow } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import { abandonedText, lostText } from "../thread-host-view.js";
import {
  type StageNames,
  THREAD_GLYPHS,
  threadDuration,
  threadModel,
  threadName,
  threadOutcome,
  threadWaitsForNetwork,
} from "../thread-text.js";

/** The lines of a `ThreadRow`: row 1, then row 2 and the outcome row when the row is not `compact`. */
export function threadRowHeight(thread: ThreadRecord, compact: boolean): number {
  if (compact) {
    return 1;
  }

  return threadOutcome(thread) ? 3 : 2;
}

/**
 * One thread in the Threads tab of a Story, or in the Factory view. Row 1: the Story id when `storyId` is set, the
 * status glyph and text, the attempt and the Stage, `waiting for network` for a thread that waits for the network,
 * `abandoned` (with the number of held entries when `held` is set) for an abandoned thread, `connection lost (…)` in
 * `danger` for a remote thread with a lost `connection`, then the `host` column (when set) and the run time on the right. Row 2: the model id and the creation time. Row 3, if there is one: the error in `danger`,
 * or the summary of the result. When `compact` is true, only row 1 shows.
 */
export function ThreadRow({
  thread,
  storyId,
  stages,
  now,
  selected,
  clickable,
  compact = false,
  host,
  connection,
  held,
  onClick,
}: {
  thread: ThreadRecord;
  /** The Story of the thread, for a list with the threads of more than one Story. */
  storyId?: string;
  stages?: StageNames;
  /** The time for the run time of a running thread. */
  now: number;
  selected: boolean;
  clickable: boolean;
  /** Shows only row 1, so that the list has one line for each thread. */
  compact?: boolean;
  /** The host of the thread, for a list with a remote thread. Without it, the row has no host column. */
  host?: string;
  /** The lost connection of a remote thread. */
  connection?: ThreadConnection;
  /** The number of held entries of an abandoned thread, when the list read it. */
  held?: number;
  onClick(): void;
}) {
  const { glyph, color } = THREAD_GLYPHS[thread.status];
  const outcome = threadOutcome(thread);
  // `ink-faint` has too little contrast on the `selection` fill.
  const secondary = selected ? theme.inkMuted : theme.inkFaint;
  const abandoned = abandonedText(thread, held);
  const lost = lostText(connection, now);

  return (
    <SelectionRow selected={selected} active={clickable} onClick={onClick}>
      <Box paddingRight={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            {storyId && (
              <Text color={theme.ink} bold>
                {storyId}{" "}
              </Text>
            )}
            <Text color={color}>{glyph} </Text>
            <Text color={thread.status === "failed" ? theme.danger : theme.ink} bold={selected}>
              {thread.status}
            </Text>
            <Text color={theme.inkMuted}> {threadName(thread, stages)}</Text>
            {threadWaitsForNetwork(thread) && <Text color={theme.stageBoard}> · waiting for network</Text>}
            {abandoned && <Text color={theme.stageBoard}>{abandoned}</Text>}
            {lost && <Text color={theme.danger}>{lost}</Text>}
          </Text>
        </Box>
        {host !== undefined && (
          <Box flexShrink={0} paddingLeft={1}>
            <Text color={secondary}>{host}</Text>
          </Box>
        )}
        <Box flexShrink={0} paddingLeft={1}>
          <Text color={secondary}>{threadDuration(thread, now)}</Text>
        </Box>
      </Box>
      {!compact && (
        <Box paddingLeft={2} paddingRight={1}>
          <Text wrap="truncate-end" color={secondary}>
            {thread.model?.modelId ?? threadModel(thread)} · {formatDateTime(thread.createdAt)}
          </Text>
        </Box>
      )}
      {!compact && outcome && (
        <Box paddingLeft={2} paddingRight={1}>
          <Text wrap="truncate-end" color={outcome.error ? theme.danger : secondary}>
            {outcome.text}
          </Text>
        </Box>
      )}
    </SelectionRow>
  );
}
