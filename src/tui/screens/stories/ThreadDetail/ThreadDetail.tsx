import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { DetailView } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import { THREAD_GLYPHS, threadDuration, threadModel, threadOutcome, threadResumable } from "../threadText.js";

/** The rows of the full detail, for the height check of the caller. */
export const THREAD_DETAIL_ROWS = 6;

/**
 * The metadata of one thread: status, model, times, last tool, worktree and result. It reads no
 * conversation. `compact` shows only the status line and the result, for a short layout.
 */
export function ThreadDetail({
  thread,
  now,
  compact = false,
}: {
  thread: ThreadRecord;
  now: number;
  compact?: boolean;
}) {
  const { glyph, color } = THREAD_GLYPHS[thread.status];
  const outcome = threadOutcome(thread);
  const duration = threadDuration(thread, now);
  const runs = thread.runs.length > 1 ? ` · run ${thread.runs.length}` : "";
  const status = (
    <Text wrap="truncate-end">
      <Text color={color}>{glyph} </Text>
      <Text color={thread.status === "failed" ? theme.danger : theme.ink}>{thread.status}</Text>
      <Text color={theme.inkMuted}>
        {runs}
        {threadResumable(thread) ? " · resumable" : ""}
      </Text>
    </Text>
  );
  const result = outcome ? (
    <Text wrap="truncate-end" color={outcome.error ? theme.danger : theme.ink}>
      {outcome.text}
    </Text>
  ) : (
    "—"
  );
  if (compact) {
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {status}
          <Text color={theme.inkFaint}> · </Text>
          <Text color={theme.inkMuted}>
            {threadModel(thread)}
            {duration ? ` · ${duration}` : ""}
          </Text>
        </Text>
        {outcome && result}
      </Box>
    );
  }
  return (
    <DetailView
      rows={[
        { label: "Status", value: status },
        { label: "Model", value: thread.model ? threadModel(thread) : "—" },
        {
          label: "Started",
          value: thread.startedAt ? `${formatDateTime(thread.startedAt)}${duration ? ` · ${duration}` : ""}` : "—",
        },
        {
          label: "Activity",
          value: thread.lastActivityAt
            ? `${formatDateTime(thread.lastActivityAt)}${thread.lastTool ? ` · ${thread.lastTool}` : ""}`
            : "—",
        },
        {
          label: "Worktree",
          value: thread.worktree ? (
            <Text wrap="truncate-start" color={theme.ink}>
              {thread.branch ? `${thread.branch} · ` : ""}
              {thread.worktree}
            </Text>
          ) : (
            "—"
          ),
        },
        { label: "Result", value: result },
      ]}
    />
  );
}
