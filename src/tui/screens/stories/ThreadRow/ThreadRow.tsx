import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { SelectionRow } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import {
  type StageNames,
  THREAD_GLYPHS,
  threadDuration,
  threadModel,
  threadName,
  threadOutcome,
} from "../threadText.js";

/**
 * One thread in the Threads tab of a Story. Row 1: the status glyph and text, the attempt and the Stage, and the
 * run time on the right. Row 2: the model id and the creation time. Row 3, if there is one: the error in `danger`,
 * or the summary of the result.
 */
export function ThreadRow({
  thread,
  stages,
  now,
  selected,
  clickable,
  onClick,
}: {
  thread: ThreadRecord;
  stages?: StageNames;
  /** The time for the run time of a running thread. */
  now: number;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const { glyph, color } = THREAD_GLYPHS[thread.status];
  const outcome = threadOutcome(thread);
  // `ink-faint` has too little contrast on the `selection` fill.
  const secondary = selected ? theme.inkMuted : theme.inkFaint;
  return (
    <SelectionRow selected={selected} active={clickable} onClick={onClick}>
      <Box paddingRight={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">
            <Text color={color}>{glyph} </Text>
            <Text color={thread.status === "failed" ? theme.danger : theme.ink} bold={selected}>
              {thread.status}
            </Text>
            <Text color={theme.inkMuted}> {threadName(thread, stages)}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} paddingLeft={1}>
          <Text color={secondary}>{threadDuration(thread, now)}</Text>
        </Box>
      </Box>
      <Box paddingLeft={2} paddingRight={1}>
        <Text wrap="truncate-end" color={secondary}>
          {thread.model?.modelId ?? threadModel(thread)} · {formatDateTime(thread.createdAt)}
        </Text>
      </Box>
      {outcome && (
        <Box paddingLeft={2} paddingRight={1}>
          <Text wrap="truncate-end" color={outcome.error ? theme.danger : secondary}>
            {outcome.text}
          </Text>
        </Box>
      )}
    </SelectionRow>
  );
}
