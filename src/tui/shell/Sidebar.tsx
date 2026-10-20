import { Box, Text } from 'ink';
import { Button, type ButtonProps, Panel } from '../components';
import { SIDEBAR_WIDTH } from './layout';
import { SidebarItem } from './SidebarItem';

/** One row of a sidebar. */
export interface SidebarEntry {
  id: string;
  label: string;
}

/**
 * A list beside the main area, with a button at the bottom: the Boards, or a Plugin Sidebar. `numbered`
 * shows the `1`–`9` keys that pick a Board.
 */
export function Sidebar({
  title,
  entries,
  current,
  emptyText,
  numbered = false,
  height,
  clickable,
  onSelect,
  button,
}: {
  title: string;
  entries: readonly SidebarEntry[];
  current: number;
  emptyText?: string;
  numbered?: boolean;
  height?: number;
  clickable: boolean;
  onSelect(id: string): void;
  button?: Pick<ButtonProps, 'label' | 'keyName' | 'onClick'>;
}) {
  return (
    <Panel title={title} width={SIDEBAR_WIDTH} height={height}>
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {entries.length === 0 && emptyText && (
          <Box paddingX={1}>
            <Text dimColor>{emptyText}</Text>
          </Box>
        )}
        {entries.map((entry, i) => (
          <SidebarItem
            key={entry.id}
            index={numbered ? i : undefined}
            name={entry.label}
            selected={i === current}
            clickable={clickable}
            onClick={() => onSelect(entry.id)}
          />
        ))}
      </Box>
      <Box flexGrow={1} minHeight={1} />
      {button && <Button {...button} clickable={clickable} />}
    </Panel>
  );
}
