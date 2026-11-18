import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ThreadConnection } from "../../../../services/thread-connection/thread-connection.js";
import { DetailView } from "../../../components/index.js";
import { formatDateTime, theme } from "../../../theme.js";
import { ThreadOutcomeText } from "../thread-outcome-text/index.js";
import { ThreadStatusText } from "../thread-status-text/index.js";
import { threadDuration, threadModel, threadOutcome, threadResumable } from "../thread-text.js";

/** The rows of the full detail, for the height check of the caller. */
export const THREAD_DETAIL_ROWS = 6;

/** The count of runs after the second run, and a note when the factory can resume the thread. */
function runsNote(thread: ThreadRecord): string {
  const runs = thread.runs.length > 1 ? ` · run ${thread.runs.length}` : "";

  return `${runs}${threadResumable(thread) ? " · resumable" : ""}`;
}

/** `text`, then the run time after a `·` when there is one. */
function withDuration(text: string, duration: string): string {
  return duration ? `${text} · ${duration}` : text;
}

/** The start time and the run time, or `—` before a start. */
function startedText(thread: ThreadRecord, duration: string): string {
  return thread.startedAt ? withDuration(formatDateTime(thread.startedAt), duration) : "—";
}

/** The time of the last activity and the last tool, or `—` without an activity. */
function activityText(thread: ThreadRecord): string {
  if (!thread.lastActivityAt) {
    return "—";
  }

  return `${formatDateTime(thread.lastActivityAt)}${thread.lastTool ? ` · ${thread.lastTool}` : ""}`;
}

/** The branch and the path of the worktree. */
function worktreeText(thread: ThreadRecord): string {
  return `${thread.branch ? `${thread.branch} · ` : ""}${thread.worktree ?? ""}`;
}

/**
 * The metadata of one thread: status, model, times, last tool, worktree and result. The status line shows
 * `waiting for network` for a thread that waits for the network, `abandoned` with the number of `held` entries for an
 * abandoned thread, and `connection lost (…)` in `danger` for a remote thread with a lost `connection`. It reads no
 * conversation. `compact` shows only the status line and the result, for a short layout.
 */
export function ThreadDetail({
  thread,
  now,
  compact = false,
  connection,
  held,
}: {
  thread: ThreadRecord;
  now: number;
  compact?: boolean;
  /** The lost connection of a remote thread. */
  connection?: ThreadConnection;
  /** The number of held entries of an abandoned thread, when the caller read it. */
  held?: number;
}) {
  const outcome = threadOutcome(thread);
  const duration = threadDuration(thread, now);

  const status = (
    <ThreadStatusText thread={thread} now={now} held={held} connection={connection} extra={runsNote(thread)} />
  );
  const result = outcome ? <ThreadOutcomeText outcome={outcome} color={theme.ink} /> : "—";

  if (compact) {
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {status}
          <Text color={theme.inkFaint}> · </Text>
          <Text color={theme.inkMuted}>{withDuration(threadModel(thread), duration)}</Text>
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
        { label: "Started", value: startedText(thread, duration) },
        { label: "Activity", value: activityText(thread) },
        {
          label: "Worktree",
          value: thread.worktree ? (
            <Text wrap="truncate-start" color={theme.ink}>
              {worktreeText(thread)}
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
