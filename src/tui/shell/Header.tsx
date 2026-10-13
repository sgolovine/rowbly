import { basename, dirname } from 'node:path';
import { Box, Text } from 'ink';
import { useContext } from 'react';
import type { RowblyContext } from '../../services';
import { Button, Panel } from '../components';
import { ServicesContext } from '../hooks';

/** The project the Data Root belongs to: the folder holding `.rowbly`, or "Global" for `~/.rowbly`. */
export function projectName(ctx: RowblyContext | null): string {
  if (!ctx) return 'Rowbly';
  if (ctx.root.kind === 'global') return 'Global';
  return basename(dirname(ctx.root.path)) || 'Rowbly';
}

export function Header({ onNewStory, clickable }: { onNewStory?: () => void; clickable: boolean }) {
  const { ctx } = useContext(ServicesContext);
  // The button sits beside the panel rather than inside it, so the header stays three lines tall.
  return (
    <Box flexShrink={0}>
      <Panel title={projectName(ctx)} flexGrow={1} flexShrink={1} paddingX={1} alignItems="flex-end">
        <Text dimColor>me: {ctx?.me ?? '—'}</Text>
      </Panel>
      {onNewStory && <Button label="+ New Story" onClick={onNewStory} clickable={clickable} compact />}
    </Box>
  );
}
