import { Box, Text } from 'ink';
import { theme } from '../../theme';
import { GUTTER_WIDTH } from './layout';

/** The column indicator shown at the edge when Stages are scrolled out of view on that side. */
export function Gutter({ text }: { text: string }) {
  return (
    <Box width={GUTTER_WIDTH} flexShrink={0}>
      <Text color={theme.accent} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
}
