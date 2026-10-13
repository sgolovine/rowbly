import { basename, dirname } from 'node:path';
import { Box, Text } from 'ink';
import { useContext } from 'react';
import type { RowblyContext } from '../../services';
import { ServicesContext } from '../hooks';
import { HeaderButton } from './HeaderButton';

/** The project the Data Root belongs to: the folder holding `.rowbly`, or "Global" for `~/.rowbly`. */
export function projectName(ctx: RowblyContext | null): string {
  if (!ctx) return 'Rowbly';
  if (ctx.root.kind === 'global') return 'Global';
  return basename(dirname(ctx.root.path)) || 'Rowbly';
}

export function Header({ onNewStory, clickable }: { onNewStory?: () => void; clickable: boolean }) {
  const { ctx } = useContext(ServicesContext);
  return (
    <Box
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderDimColor
      flexShrink={0}
    >
      <Text bold color="cyan" wrap="truncate-end">
        {projectName(ctx)}
      </Text>
      <Box gap={2} flexShrink={0}>
        <Text dimColor>me: {ctx?.me ?? '—'}</Text>
        {onNewStory && <HeaderButton label="+ New Story" onClick={onNewStory} clickable={clickable} />}
      </Box>
    </Box>
  );
}
