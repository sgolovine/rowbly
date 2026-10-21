import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { StageBadge } from '../../components';
import { useMouse } from '../../hooks';
import { theme } from '../../theme';
import type { ListRow } from './layout';

export interface BoardListRowProps {
  row: ListRow;
  /** The Plugins' badges for a Story line, as on its board card. */
  badges: readonly string[];
  width: number;
  selected: boolean;
  active: boolean;
  onClick(): void;
}

/**
 * One line of the list view: a section heading with its count, or a Story's key and name with its Plugin badges
 * and Stage, above a dim rule that spaces the lines apart.
 */
export function BoardListRow({ row, badges, width, selected, active, onClick }: BoardListRowProps) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active);
  const marker = (
    <Box flexShrink={0}>
      <Text color={selected && active ? theme.accent : theme.inkFaint}>{selected ? '▌ ' : '  '}</Text>
    </Box>
  );
  const line =
    row.kind === 'section' ? (
      <Box>
        {marker}
        <Text bold wrap="truncate-end">
          {`${row.collapsed ? '▸' : '▾'} ${row.title} `}
          <Text color={theme.inkFaint}>
            ({row.count}){row.count === 0 && !row.collapsed ? '  No Stories' : ''}
          </Text>
        </Text>
      </Box>
    ) : (
      <Box paddingLeft={2} paddingRight={1}>
        {marker}
        <Box flexGrow={1} flexShrink={1} minWidth={row.story.key.length + 1}>
          <Text wrap="truncate-end" bold={selected}>
            <Text color={theme.accent}>{row.story.key}</Text> {row.story.name}
          </Text>
        </Box>
        {badges.length > 0 && (
          <Box flexShrink={1} minWidth={0} maxWidth={Math.floor(width * 0.4)} marginLeft={2}>
            <Text color={theme.inkFaint} wrap="truncate-end">
              {badges.join(' · ')}
            </Text>
          </Box>
        )}
        <Box flexShrink={0} marginLeft={2}>
          <StageBadge stage={row.stage} />
        </Box>
      </Box>
    );
  return (
    <Box
      ref={ref}
      width={width}
      flexDirection="column"
      backgroundColor={selected && active ? theme.selection : undefined}
    >
      {line}
    </Box>
  );
}
