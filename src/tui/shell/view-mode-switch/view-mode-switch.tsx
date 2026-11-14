import { Box, Text } from "ink";
import { Switch } from "../../components/index.js";
import { theme } from "../../theme.js";

/** The labels of the two view modes. They have the same length, so the width does not change with the mode. */
const OFF_LABEL = "Stories";
const ON_LABEL = "Threads";

/** The columns of the switch: its padding, the track, the label and, `withKey`, the gap and the key cap. */
export function viewModeSwitchWidth(withKey: boolean): number {
  return 1 + 3 + 1 + Math.max(OFF_LABEL.length, ON_LABEL.length) + (withKey ? 4 : 0) + 1;
}

/**
 * The switch of the view mode in the Factory group of the header, with the key `t`: `●── Stories` shows the Story
 * list, and `━━● Threads` shows the Factory view. A click changes the view mode.
 */
export function ViewModeSwitch({
  threads,
  showKey,
  onToggle,
  clickable,
}: {
  threads: boolean;
  showKey: boolean;
  onToggle(): void;
  clickable: boolean;
}) {
  return (
    <Box paddingX={1} gap={1} flexShrink={0}>
      <Switch on={threads} onLabel={ON_LABEL} offLabel={OFF_LABEL} onChange={() => onToggle()} clickable={clickable} />
      {showKey && (
        <Text backgroundColor={theme.keycap} color={theme.inkMuted}>
          {" "}
          t{" "}
        </Text>
      )}
    </Box>
  );
}
