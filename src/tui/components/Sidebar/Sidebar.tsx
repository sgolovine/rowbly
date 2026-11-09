import { Box, type DOMElement, measureElement, Text } from "ink";
import { useRef, useState } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { Button, type ButtonProps } from "../Button/index.js";
import { Panel } from "../Panel/index.js";
import { SidebarItem } from "../SidebarItem/index.js";
import { SIDEBAR_CHROME_HEIGHT, SIDEBAR_MIN_WIDTH } from "../shellLayout.js";

/** One row of a sidebar. */
export interface SidebarEntry {
  id: string;
  label: string;
  /** Shows a `✎` that calls the sidebar's `onEdit` with this entry. */
  editable?: boolean;
  /** Lets the mouse drag the entry to another row, which calls the sidebar's `onMove`. */
  movable?: boolean;
}

/** What a drag of a `movable` entry carries: its id, and the sidebar that it comes from. */
interface DraggedEntry {
  sidebar: object;
  id: string;
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
}: {
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
}) {
  const ref = useRef<DOMElement>(null);
  const edge = useRef<DOMElement>(null);
  // Tells this sidebar's drags from the drags of other components.
  const self = useRef({}).current;
  const [over, setOver] = useState<string | null>(null);
  const dragged = (value: unknown): value is DraggedEntry => (value as DraggedEntry | null)?.sidebar === self;
  // The edge is the right border and the gap after it; the pointer's column becomes the border's.
  useMouse(
    edge,
    {
      onPull(x) {
        const left = ref.current ? measureElement(ref.current).x : 0;
        const next = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, x - left + 1));
        if (next !== width) onResize?.(next);
      },
    },
    clickable && onResize !== undefined,
  );
  const room = height === undefined ? entries.length : Math.max(1, height - SIDEBAR_CHROME_HEIGHT);
  const overflow = entries.length > room;
  // One row each for the `↑ n more` and `↓ n more` lines, when the entries do not fit.
  const limit = overflow ? Math.max(1, room - 2) : entries.length;
  const start = Math.max(0, Math.min(current - Math.floor(limit / 2), entries.length - limit));
  const below = entries.length - start - limit;
  useMouse(
    ref,
    {
      onWheel: (direction) => {
        const entry = entries[Math.max(0, Math.min(entries.length - 1, current + direction))];
        if (entry) onSelect(entry.id);
      },
    },
    clickable && overflow,
  );
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
          {overflow && <Text color={theme.inkFaint}>{start > 0 ? `  ↑ ${start} more` : " "}</Text>}
          {entries.slice(start, start + limit).map((entry, shown) => {
            const i = start + shown;
            return (
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
                onEdit={
                  onEdit && entry.editable
                    ? () => {
                        onFocus();
                        onEdit(entry.id);
                      }
                    : undefined
                }
                drag={onMove && entry.movable ? ({ sidebar: self, id: entry.id } satisfies DraggedEntry) : undefined}
                onDrop={
                  onMove
                    ? (value) => {
                        setOver(null);
                        if (!dragged(value) || value.id === entry.id) return;
                        onFocus();
                        onMove(value.id, i);
                      }
                    : undefined
                }
                onDragOver={(value) => setOver(dragged(value) ? entry.id : null)}
                onDragLeave={() => setOver((id) => (id === entry.id ? null : id))}
                dropTarget={over === entry.id}
              />
            );
          })}
          {overflow && <Text color={theme.inkFaint}>{below > 0 ? `  ↓ ${below} more` : " "}</Text>}
        </Box>
        <Box flexGrow={1} />
        {button && <Button {...button} keyName={focused ? "n" : undefined} clickable={clickable} />}
      </Panel>
      {onResize && <Box ref={edge} position="absolute" top={0} right={-1} width={2} height="100%" />}
    </Box>
  );
}
