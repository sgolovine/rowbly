import { Box, Text } from 'ink';
import { failureMessage, type PluginFieldFailure } from './pluginFields';

/** Names each Plugin form or filter callback that failed, with `note` on what it means here. */
export function PluginFailures({ failures, note }: { failures: readonly PluginFieldFailure[]; note?: string }) {
  if (failures.length === 0) return null;
  return (
    <Box flexDirection="column">
      {failures.map((failure) => (
        <Box key={`${failure.plugin}:${failure.stage}`} flexDirection="column">
          <Text color="yellow">{failureMessage(failure)}</Text>
          {note && <Text dimColor>{`  ${note}`}</Text>}
        </Box>
      ))}
    </Box>
  );
}
