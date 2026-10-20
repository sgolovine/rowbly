import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { StageBadge } from '../../components';
import { useMouse } from '../../hooks';
import type { ListRow } from './layout';

export interface BoardListRowProps {
  row: ListRow;
  width: number;
  selected: boolean;
  active: boolean;
  onClick(): void;
}

/**
 * One line of the list view: a section heading with its count, or a Story's key and name with its Stage, above
 * a dim rule that spaces the lines apart.
 */
export function BoardListRow({ row, width, selected, active, onClick }: BoardListRowProps) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active);
  const marker = <Text color={selected && active ? 'cyan' : undefined}>{selected ? '› ' : '  '}</Text>;
  const line =
    row.kind === 'section' ? (
      <Box>
        {marker}
        <Text bold wrap="truncate-end">
          {`${row.collapsed ? '▸' : '▾'} ${row.title} `}
          <Text dimColor>({row.count})</Text>
        </Text>
      </Box>
    ) : (
      <Box paddingLeft={2} paddingRight={1}>
        {marker}
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end" bold={selected}>
            <Text color="cyan">{row.story.key}</Text> {row.story.name}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={2}>
          <StageBadge stage={row.stage} />
        </Box>
      </Box>
    );
  return (
    <Box ref={ref} width={width} flexDirection="column">
      {line}
      <Text dimColor>{'─'.repeat(Math.max(0, width))}</Text>
    </Box>
  );
}
