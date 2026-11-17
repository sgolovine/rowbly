import { Box, Text } from "ink";
import type { HostRow } from "../../../../services/host-project/host-rows.js";
import { Button, Switch } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The props of `HostActionsBar`. */
export interface HostActionsBarProps {
  readonly row: HostRow;
  /** False while a form on top has the keys; then the controls do not take a click. */
  readonly clickable: boolean;
  /** True while remote work runs; then the use switch and the check do not take a click. */
  readonly busy: boolean;
  readonly onToggleProject: () => void;
  readonly onToggleEnabled: () => void;
  readonly onWorkers: () => void;
  readonly onCheck: () => void;
}

/** The controls of the selected host. Each control has the same key as in the hints. */
export function HostActionsBar({
  row,
  clickable,
  busy,
  onToggleProject,
  onToggleEnabled,
  onWorkers,
  onCheck,
}: HostActionsBarProps) {
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      marginTop={1}
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
    >
      <Text bold color={theme.ink}>
        {row.host.id}
      </Text>
      <Box gap={2} flexWrap="wrap">
        <Box gap={1} flexShrink={0}>
          <Text color={theme.inkMuted}>On for this Project</Text>
          <Switch on={row.usedByProject} clickable={clickable && !busy} onChange={onToggleProject} />
          <Text color={theme.inkFaint}>u</Text>
        </Box>
        <Box gap={1} flexShrink={0}>
          <Text color={theme.inkMuted}>On for all Projects</Text>
          <Switch on={row.host.enabled} clickable={clickable} onChange={onToggleEnabled} />
          <Text color={theme.inkFaint}>e</Text>
        </Box>
      </Box>
      <Box gap={2} flexWrap="wrap">
        <Button label="Worker limit" keyName="w" compact clickable={clickable} onClick={onWorkers} />
        <Button label="Check" keyName="c" compact busy={busy} clickable={clickable && !busy} onClick={onCheck} />
      </Box>
      <Text color={theme.inkFaint} wrap="wrap">
        On for this Project clones the Project in the managed folder on the host. The clone can take minutes.
      </Text>
    </Box>
  );
}
