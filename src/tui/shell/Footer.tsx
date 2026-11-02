import { Box, Text } from 'ink';
import pkg from '../../../package.json' with { type: 'json' };
import { KeyHints } from '../components';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';

export function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  return (
    <Box paddingX={1} flexShrink={0} columnGap={2} justifyContent="space-between">
      <KeyHints
        hints={hints.filter(
          (hint) =>
            !hint.secondary &&
            !(hint.key === 'n' && hint.description === 'new Story') &&
            hint.key !== 'v' &&
            !(hint.key === 'S' && hint.description === 'Sync'),
        )}
      />
      <Box flexShrink={0} columnGap={2}>
        <KeyHints hints={[{ key: '?', description: 'help' }, ...(atRoot ? [{ key: 'q', description: 'quit' }] : [])]} />
        <Text color={theme.inkFaint}>v{pkg.version}</Text>
      </Box>
    </Box>
  );
}
