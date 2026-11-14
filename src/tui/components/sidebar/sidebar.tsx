import { Box, type DOMElement, Text } from "ink";
import { useRef, useState } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { Button, type ButtonProps } from "../button/index.js";
import { Panel } from "../panel/index.js";
import { ResizeEdge } from "../resize-edge/index.js";
import { SIDEBAR_CHROME_HEIGHT, SIDEBAR_MIN_WIDTH } from "../shell-layout.js";
import { type SidebarEntry, SidebarRow, type SidebarRowEnv } from "../sidebar-row/index.js";

interface SidebarProps {
  title: string;
  entries: readonly SidebarEntry[];
  current: number;
  emptyText?: string;
  numbered?: boolean;
  height?: number;
  width: number;
  maxWidth: number;
  onResize?(width: number): void;
  focused: boolean;
  clickable: boolean;
  onFocus(): void;
  onSelect(id: string): void;
  onEdit?(id: string): void;
  /** The entry `id` was dropped on the row at `index`. */
  onMove?(id: string, index: number): void;
  button?: Pick<ButtonProps, "label" | "onClick">;
}

/** A wheel notch selects the entry before or after the current one. */
function wheelSelect(
  entries: readonly SidebarEntry[],
  current: number,
  onSelect: (id: string) => void,
  direction: number,
): void {
  const entry = entries[Math.max(0, Math.min(entries.length - 1, current + direction))];

  if (entry) {
    onSelect(entry.id);
  }
}

/** The text of a `↑ n more` or `↓ n more` row; a blank row keeps its line when there is nothing more. */
function moreText(arrow: string, count: number): string {
  return count > 0 ? `  ${arrow} ${count} more` : " ";
}

/**
 * A list beside the main area, with a button at the bottom: the Boards, or a Plugin Sidebar. `numbered`
 * shows the `1`–`9` keys that pick a Board. A click in it calls `onFocus`; while `focused`, its border
 * lights up and the shell gives it `↑`/`↓` and `n`, which the button shows. Dragging its right edge
 * calls `onResize` with the new width, no wider than `maxWidth` nor narrower than `SIDEBAR_MIN_WIDTH`;
 * without `onResize`, the edge does not drag. When there are more entries than `height` fits, the sidebar
 * shows the entries around `current` and says how many more are above and below, and the wheel selects.
 * A click on the `✎` of an `editable` entry focuses the sidebar and calls `onEdit`. A `movable` entry
 * dropped on another row focuses the sidebar and calls `onMove` with the index of that row.
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
  onEdit,
  onMove,
  button,
}: SidebarProps) {
  const ref = useRef<DOMElement>(null);
  // Tells this sidebar's drags from the drags of other components.
  const self = useRef({}).current;
  const [over, setOver] = useState<string | null>(null);

  const room = height === undefined ? entries.length : Math.max(1, height - SIDEBAR_CHROME_HEIGHT);
  const overflow = entries.length > room;
  // One row each for the `↑ n more` and `↓ n more` lines, when the entries do not fit.
  const limit = overflow ? Math.max(1, room - 2) : entries.length;
  const start = Math.max(0, Math.min(current - Math.floor(limit / 2), entries.length - limit));
  const below = entries.length - start - limit;
  const env: SidebarRowEnv = { self, onFocus, onSelect, onEdit, onMove, setOver };

  useMouse(ref, { onWheel: (direction) => wheelSelect(entries, current, onSelect, direction) }, clickable && overflow);

  // The outer box is the Panel's size, so the edge is at its right border and as tall as it, in any parent.
  return (
    <Box ref={ref} flexShrink={0} width={width} height={height}>
      <Panel title={title} width={width} height={height} focused={focused} onClick={clickable ? onFocus : undefined}>
        <Box flexDirection="column" flexShrink={1} overflow="hidden">
          {entries.length === 0 && emptyText && (
            <Box paddingX={1}>
              <Text color={theme.inkFaint}>{emptyText}</Text>
            </Box>
          )}
          {overflow && <Text color={theme.inkFaint}>{moreText("↑", start)}</Text>}
          {entries.slice(start, start + limit).map((entry, shown) => (
            <SidebarRow
              key={entry.id}
              entry={entry}
              index={start + shown}
              selected={start + shown === current}
              numbered={numbered}
              clickable={clickable}
              dropTarget={over === entry.id}
              env={env}
            />
          ))}
          {overflow && <Text color={theme.inkFaint}>{moreText("↓", below)}</Text>}
        </Box>
        <Box flexGrow={1} />
        {button && <Button {...button} keyName={focused ? "n" : undefined} clickable={clickable} />}
      </Panel>
      {onResize && (
        <ResizeEdge
          target={ref}
          side="right"
          width={width}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={maxWidth}
          active={clickable}
          onResize={onResize}
        />
      )}
    </Box>
  );
}
