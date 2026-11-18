import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import { Modal, modalSize, SelectList } from "../../../components/index.js";
import { useEscape, useIsActive, useKeyCapture, useLayout } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { checkJobRow, liveChecks, orderedCheckJobs } from "../check-jobs.js";
import { checksText } from "../factory-modal-text.js";

/** The text of the Modal when the queue has no jobs. */
const EMPTY_TEXT = "No checks run or wait.";

/** The keys of the Modal. */
const CHECKS_HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "/", description: "filter" },
  { key: "esc", description: "close" },
];

/** The props of `ChecksModal`. */
export interface ChecksModalProps {
  /** The factory status that the shell polls. The Modal shows its `checks`. */
  readonly status: FactoryStatus | undefined;
  /** The labels of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  readonly onClose: () => void;
}

/** The time that counts up each second while the queue has jobs, for the time of each row. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!ticking) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [ticking]);

  return now;
}

/** The rows of the list that fit in the body of the Modal, under the summary line and its gap. */
function listLimit(height: number | undefined): number {
  return Math.max(1, Math.min(12, (height ?? 14) - 3));
}

/**
 * The checks in the queue of the live factory, for all Threads, in a generic Modal. The summary line is at the
 * top. The running checks come first, then the queued checks in the order of the queue. The Modal is read-only.
 * `↑/↓` select, `/` filters, and `esc` or the `✕` close it.
 */
export function ChecksModal({ status, stages, onClose }: ChecksModalProps) {
  const active = useIsActive();
  const { body } = modalSize(useLayout(), { footer: true });
  const [filtering, setFiltering] = useState(false);

  const checks = liveChecks(status);
  const jobs = checks ? orderedCheckJobs(checks) : [];
  const now = useNow(jobs.length > 0);

  useKeyCapture(active, { text: false, escape: true });
  useEscape(active && !filtering, onClose);

  return (
    <Modal title="Factory › Checks" onClose={onClose} hints={CHECKS_HINTS}>
      <Box flexDirection="column">
        <Text color={theme.inkMuted} wrap="truncate-end">
          {checks ? checksText(checks) : "The factory does not run checks now."}
        </Text>
        <Box marginTop={1}>
          <SelectList
            items={jobs.map((job) => checkJobRow(job, stages, now))}
            emptyText={EMPTY_TEXT}
            limit={listLimit(body.height)}
            onFilteringChange={setFiltering}
            isActive={active}
          />
        </Box>
      </Box>
    </Modal>
  );
}
