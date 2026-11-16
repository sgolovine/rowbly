import { Box, Text } from "ink";
import type { HostRow } from "../../../../services/host-project/host-rows.js";
import { Loading, SelectionRow, Switch } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";
import { busyText, type HostBusy, lastCheckText, workersText } from "../hosts-section/hosts-view.js";

/** The props of `HostList`. */
export interface HostListProps {
  readonly rows: readonly HostRow[];
  /** The index of the highlighted row. */
  readonly cursor: number;
  /** The list has the keys, and the rows take a click. */
  readonly active: boolean;
  readonly busy: HostBusy | null;
  readonly onPick: (index: number) => void;
}

/** The props of `HostListRow`. */
interface HostListRowProps {
  readonly row: HostRow;
  readonly idWidth: number;
  readonly sshWidth: number;
  readonly busy: HostBusy | null;
}

/** The last check, or a spinner while remote work runs on the host. */
function RowState({ row, busy }: { readonly row: HostRow; readonly busy: HostBusy | null }) {
  if (busy?.hostId === row.host.id) {
    return <Loading label={busyText(busy)} />;
  }

  return (
    <Text color={row.lastCheck ? theme.inkMuted : theme.inkFaint} wrap="truncate-end">
      {lastCheckText(row.lastCheck)}
    </Text>
  );
}

/** Two lines for a host: the ID, the SSH target and the worker limit, then the two switches and the last check. */
function HostListRow({ row, idWidth, sshWidth, busy }: HostListRowProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={idWidth} flexShrink={0}>
          <Text bold color={theme.ink}>
            {row.host.id}
          </Text>
        </Box>
        <Box width={sshWidth} flexShrink={0}>
          <Text color={theme.inkMuted}>{row.host.ssh}</Text>
        </Box>
        <Text color={theme.inkMuted}>{workersText(row.host.maxWorkers)}</Text>
      </Box>
      <Box gap={2}>
        <Box gap={1} flexShrink={0}>
          <Text color={theme.inkFaint}>this Project</Text>
          <Switch on={row.usedByProject} />
        </Box>
        <Box gap={1} flexShrink={0}>
          <Text color={theme.inkFaint}>all Projects</Text>
          <Switch on={row.host.enabled} />
        </Box>
        <RowState row={row} busy={busy} />
      </Box>
    </Box>
  );
}

/** One row for each worker host, in the order of `~/.rowblyrc.json`. A click selects the host. */
export function HostList({ rows, cursor, active, busy, onPick }: HostListProps) {
  const idWidth = columnWidth(
    rows.map((row) => row.host.id),
    2,
  );
  const sshWidth = columnWidth(
    rows.map((row) => row.host.ssh),
    2,
  );

  return (
    <Box flexDirection="column" flexShrink={0}>
      {rows.map((row, index) => (
        <SelectionRow
          key={row.host.id}
          selected={index === cursor}
          active={active}
          onClick={active ? () => onPick(index) : undefined}
        >
          <HostListRow row={row} idWidth={idWidth} sshWidth={sshWidth} busy={busy} />
        </SelectionRow>
      ))}
    </Box>
  );
}
