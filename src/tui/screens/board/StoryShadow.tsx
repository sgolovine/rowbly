import { Box, Text } from 'ink';
import { theme } from '../../theme';
import { CARD_HEIGHT } from './layout';

/** Where a dragged Story will land: a `dropTarget` block the size of a StoryCard, with no frame. */
export function StoryShadow({ width }: { width: number }) {
  const blank = ' '.repeat(width);
  return (
    <Box flexDirection="column" width={width}>
      {Array.from({ length: CARD_HEIGHT }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical blank lines.
        <Text key={i} backgroundColor={theme.dropTarget}>
          {blank}
        </Text>
      ))}
    </Box>
  );
}
