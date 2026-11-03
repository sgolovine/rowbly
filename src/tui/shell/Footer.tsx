import { Box, Text } from 'ink';
import pkg from '../../../package.json' with { type: 'json' };
import { KeyHints } from '../components';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';
import { UpdateNotice } from './UpdateNotice';

export function Footer({
  hints,
  atRoot,
  newerVersion,
}: {
  hints: readonly KeyHint[];
  atRoot: boolean;
  /** A newer Rowbly release, offered on a row of its own above the keys. */
  newerVersion?: string | null;
}) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {newerVersion && <UpdateNotice version={newerVersion} />}
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
          <KeyHints
            hints={[{ key: '?', description: 'help' }, ...(atRoot ? [{ key: 'q', description: 'quit' }] : [])]}
          />
          <Text color={theme.inkFaint}>v{pkg.version}</Text>
        </Box>
      </Box>
    </Box>
  );
}
