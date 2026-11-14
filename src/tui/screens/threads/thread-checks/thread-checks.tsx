import { Box, Text } from "ink";
import type { ThreadCheck } from "../../../../services/thread/thread.js";
import { theme } from "../../../theme.js";

/** The pane shows the last checks of a Thread, newest last. */
export const THREAD_CHECK_ROWS = 3;

const FAILED = ["failed", "timed_out", "error"];

/** The props of `ThreadChecks`. */
export interface ThreadChecksProps {
  readonly checks: readonly ThreadCheck[] | undefined;
}

/** The rows that the checks take in the pane: one for each shown check. */
export function threadCheckRows(checks: readonly ThreadCheck[] | undefined): number {
  return Math.min(THREAD_CHECK_ROWS, checks?.length ?? 0);
}

/** The status and the duration of a check, for example `passed · 1m40s`. */
export function checkStatusText(check: ThreadCheck): string {
  const status = check.status.replace("_", " ");

  if (check.durationSeconds === undefined || ["queued", "running"].includes(check.status)) {
    return status;
  }

  const minutes = Math.floor(check.durationSeconds / 60);
  const seconds = check.durationSeconds % 60;
  const duration = minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;

  return `${status} · ${duration}`;
}

/** The last checks of a Thread: the check key, the scope, the status and the duration of each. */
export function ThreadChecks({ checks }: ThreadChecksProps) {
  const shown = (checks ?? []).slice(-THREAD_CHECK_ROWS);

  if (!shown.length) {
    return null;
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      {shown.map((check) => (
        <Text key={check.id} wrap="truncate-end">
          <Text color={theme.inkMuted}>Check </Text>
          <Text color={theme.ink}>{check.key}</Text>
          <Text color={theme.inkFaint}> {check.scope} · </Text>
          <Text color={FAILED.includes(check.status) ? theme.danger : theme.ink}>{checkStatusText(check)}</Text>
        </Text>
      ))}
    </Box>
  );
}
