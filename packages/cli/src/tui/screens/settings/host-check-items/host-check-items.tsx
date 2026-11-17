import { Box, Text } from "ink";
import type { CheckItem, HostCheck } from "../../../../services/host-check/host-check.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";

/** The props of `HostCheckItems`. */
export interface HostCheckItemsProps {
  readonly check: HostCheck;
}

const STATE_COLORS: Readonly<Record<CheckItem["state"], string>> = {
  ok: theme.ink,
  warning: theme.stageBoard,
  fail: theme.danger,
  skipped: theme.inkFaint,
};

function needsAction(item: CheckItem): boolean {
  return (item.state === "fail" || item.state === "warning") && item.action !== undefined;
}

/** One item: its state and its label, then its detail, then its action for a `fail` or a `warning`. */
function CheckItemRow({ item, stateWidth }: { readonly item: CheckItem; readonly stateWidth: number }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={stateWidth} flexShrink={0}>
          <Text color={STATE_COLORS[item.state]}>{item.state}</Text>
        </Box>
        <Text color={theme.ink}>{item.label}</Text>
      </Box>
      <Box paddingLeft={stateWidth}>
        <Text color={theme.inkMuted} wrap="wrap">
          {item.detail}
        </Text>
      </Box>
      {needsAction(item) && (
        <Box paddingLeft={stateWidth}>
          <Text color={theme.ink} wrap="wrap">
            Action: {item.action}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/** The items of a check of this session, with the state of the host at the top. */
export function HostCheckItems({ check }: HostCheckItemsProps) {
  const stateWidth = columnWidth(
    check.items.map((item) => item.state),
    2,
  );

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold color={theme.ink}>
        Check of {check.host}: {check.ready ? "ready" : "not ready"}
      </Text>
      {check.items.map((item) => (
        <CheckItemRow key={item.id} item={item} stateWidth={stateWidth} />
      ))}
    </Box>
  );
}
