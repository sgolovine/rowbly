import { Box } from 'ink';
import { KeyHints } from '../components';
import type { KeyHint } from '../keymap';

export function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  return (
    <Box paddingX={1} flexShrink={0} columnGap={2} justifyContent="space-between">
      <KeyHints hints={hints.filter((hint) => !hint.secondary)} />
      <Box flexShrink={0}>
        <KeyHints hints={[{ key: '?', description: 'help' }, ...(atRoot ? [{ key: 'q', description: 'quit' }] : [])]} />
      </Box>
    </Box>
  );
}
