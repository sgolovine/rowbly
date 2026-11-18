import { Box, Text } from "ink";
import { formatDateTime, theme } from "../../../theme.js";

/** The width of the labels, the same as the labels of the dependency lists. */
const LABEL_WIDTH = 12;

/** The saved times of a Story, and the time zone that shows them. */
export interface StoryTimes {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** `undefined` shows the times in the time zone of the system. */
  readonly timeZone: string | undefined;
}

/** One label and one time, or `—` when the Story has no time. */
function TimeRow({ label, value, timeZone }: { label: string; value: string | null; timeZone: string | undefined }) {
  return (
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text color={theme.inkMuted}>{label}</Text>
      </Box>
      {value === null ? (
        <Text color={theme.inkFaint}>—</Text>
      ) : (
        <Text color={theme.ink}>{formatDateTime(value, timeZone)}</Text>
      )}
    </Box>
  );
}

/** The time when the Story was created and the time of its last change, in the time zone of the settings. */
export function StoryTimeRows({ times }: { times: StoryTimes }) {
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      <TimeRow label="Created" value={times.createdAt} timeZone={times.timeZone} />
      <TimeRow label="Updated" value={times.updatedAt} timeZone={times.timeZone} />
    </Box>
  );
}
