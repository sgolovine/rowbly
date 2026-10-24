import { Box, type DOMElement, measureElement, Text } from 'ink';
import { useRef } from 'react';
import { Button, type ButtonProps, Panel } from '../components';
import { useMouse } from '../hooks';
import { theme } from '../theme';
import { SIDEBAR_MIN_WIDTH } from './layout';
import { SidebarItem } from './SidebarItem';

/** One row of a sidebar. */
export interface SidebarEntry {
  id: string;
  label: string;
}

/**
 * A list beside the main area, with a button at the bottom: the Boards, or a Plugin Sidebar. `numbered`
 * shows the `1`–`9` keys that pick a Board. A click in it calls `onFocus`; while `focused`, its border
 * lights up and the shell gives it `↑`/`↓` and `n`, which the button shows. Dragging its right edge
 * calls `onResize` with the new width, no wider than `maxWidth` nor narrower than `SIDEBAR_MIN_WIDTH`.
 * A right click on an entry focuses the sidebar and calls `onContextMenu`, to open a menu there.
 */
export function Sidebar({
  title,
  entries,
  current,
  emptyText,
  numbered = false,
  height,
  width,
  maxWidth,
  onResize,
  focused,
  clickable,
  onFocus,
  onSelect,
  onContextMenu,
  button,
}: {
  title: string;
  entries: readonly SidebarEntry[];
  current: number;
  emptyText?: string;
  numbered?: boolean;
  height?: number;
  width: number;
  maxWidth: number;
  onResize(width: number): void;
  focused: boolean;
  clickable: boolean;
  onFocus(): void;
  onSelect(id: string): void;
  /** A right click on the entry `id`, at cell `x`, `y`. */
  onContextMenu?(id: string, x: number, y: number): void;
  button?: Pick<ButtonProps, 'label' | 'onClick'>;
}) {
  const ref = useRef<DOMElement>(null);
  const edge = useRef<DOMElement>(null);
  // The edge is the right border and the gap after it; the pointer's column becomes the border's.
  useMouse(
    edge,
    {
      onPull(x) {
        const left = ref.current ? measureElement(ref.current).x : 0;
        const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, x - left + 1));
        if (next !== width) onResize(next);
      },
    },
    clickable,
  );
  return (
    <Box ref={ref} flexShrink={0}>
      <Panel title={title} width={width} height={height} focused={focused} onClick={clickable ? onFocus : undefined}>
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
              onContextMenu={
                onContextMenu
                  ? (x, y) => {
                      onFocus();
                      onContextMenu(entry.id, x, y);
                    }
                  : undefined
              }
            />
          ))}
        </Box>
        <Box flexGrow={1} minHeight={1} />
        {button && <Button {...button} keyName={focused ? 'n' : undefined} clickable={clickable} />}
      </Panel>
      <Box ref={edge} position="absolute" top={0} right={-1} width={2} height="100%" />
    </Box>
  );
}
