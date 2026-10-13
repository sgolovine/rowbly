import { basename, dirname } from 'node:path';
import { Box, Text } from 'ink';
import { useContext } from 'react';
import type { RowblyContext } from '../../services';
import { Button, Panel } from '../components';
import { type HeaderLabel, ServicesContext } from '../hooks';

/** The project the Data Root belongs to: the folder holding `.rowbly`, or "Global" for `~/.rowbly`. */
export function projectName(ctx: RowblyContext | null): string {
  if (!ctx) return 'Rowbly';
  if (ctx.root.kind === 'global') return 'Global';
  return basename(dirname(ctx.root.path)) || 'Rowbly';
}

export function Header({
  label,
  onNewStory,
  clickable,
}: {
  label: HeaderLabel | null;
  onNewStory?: () => void;
  clickable: boolean;
}) {
  const { ctx } = useContext(ServicesContext);
  // The button sits beside the panel rather than inside it, so the header stays three lines tall.
  return (
    <Box flexShrink={0}>
      <Panel title={projectName(ctx)} flexGrow={1} flexShrink={1} paddingX={1} flexDirection="row" columnGap={2}>
        <Box flexGrow={1} flexShrink={1}>
          {label && (
            <Text wrap="truncate-end">
              <Text bold>{label.title}</Text>
              {label.detail && <Text dimColor>{` ${label.detail}`}</Text>}
            </Text>
          )}
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>me: {ctx?.me ?? '—'}</Text>
        </Box>
      </Panel>
      {onNewStory && <Button label="+ New Story" onClick={onNewStory} clickable={clickable} compact />}
    </Box>
  );
}
