import { Box, Text } from 'ink';
import { Button, type ButtonProps, Panel } from '../components';
import { theme } from '../theme';
import { SIDEBAR_WIDTH } from './layout';
import { SidebarItem } from './SidebarItem';

/** One row of a sidebar. */
export interface SidebarEntry {
  id: string;
  label: string;
}

/**
 * A list beside the main area, with a button at the bottom: the Boards, or a Plugin Sidebar. `numbered`
 * shows the `1`–`9` keys that pick a Board. A click in it calls `onFocus`; while `focused`, its border
 * lights up and the shell gives it `↑`/`↓` and `n`, which the button shows.
 */
export function Sidebar({
  title,
  entries,
  current,
  emptyText,
  numbered = false,
  height,
  focused,
  clickable,
  onFocus,
  onSelect,
  button,
}: {
  title: string;
  entries: readonly SidebarEntry[];
  current: number;
  emptyText?: string;
  numbered?: boolean;
  height?: number;
  focused: boolean;
  clickable: boolean;
  onFocus(): void;
  onSelect(id: string): void;
  button?: Pick<ButtonProps, 'label' | 'onClick'>;
}) {
  return (
    <Panel
      title={title}
      width={SIDEBAR_WIDTH}
      height={height}
      focused={focused}
      onClick={clickable ? onFocus : undefined}
    >
      <Box flexDirection="column" flexShrink={1} overflow="hidden">
        {entries.length === 0 && emptyText && (
          <Box paddingX={1}>
            <Text color={theme.inkFaint}>{emptyText}</Text>
          </Box>
        )}
        {entries.map((entry, i) => (
          <SidebarItem
            key={entry.id}
            index={numbered ? i : undefined}
            name={entry.label}
            selected={i === current}
            clickable={clickable}
            onClick={() => {
              onFocus();
              onSelect(entry.id);
            }}
          />
        ))}
      </Box>
      <Box flexGrow={1} minHeight={1} />
      {button && <Button {...button} keyName={focused ? 'n' : undefined} clickable={clickable} />}
    </Panel>
  );
}
