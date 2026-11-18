import { Box, type DOMElement, type Key, Text, useInput } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useRef, useState } from "react";
import { useIsActive, useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { ScrollFocusContext } from "../scroll-focus.js";
import { clampOffset, wheelOffset } from "../scroll-offset.js";
import { measureRows, revealOffset, rowsInView, viewRoom } from "./virtual-window.js";

interface VirtualListProps<T> {
  readonly items: readonly T[];
  /** The height in lines of the row of `item`. */
  readonly rowHeight: (item: T, index: number) => number;
  /** Renders the row of `item` at `index` of the full list. The element must have a `key`. */
  readonly renderRow: (item: T, index: number) => ReactNode;
  /** The index of the selected row. The list scrolls the least lines that bring it into view when it changes. */
  readonly cursor?: number;
  /** The lines of the list, or undefined to show all rows. */
  readonly height?: number;
  /** Page Up/Down scroll, and the wheel scrolls when `wheel` is not given. */
  readonly active?: boolean;
  /** The wheel scrolls; the default is `active`. */
  readonly wheel?: boolean;
}

/** The first line in view, and the cursor position of the last reveal. */
interface ViewState {
  readonly offset: number;
  readonly revealed: string;
}

interface PageEnv {
  readonly room: number;
  readonly max: number;
  readonly start: number;
  readonly setView: Dispatch<SetStateAction<ViewState>>;
}

function pageKey(env: PageEnv, key: Key): void {
  if (key.pageDown || key.pageUp) {
    env.setView((view) => ({ ...view, offset: clampOffset(env.start + (key.pageUp ? -1 : 1) * env.room, env.max) }));
  }
}

function wheelView(view: ViewState, max: number, direction: number): ViewState {
  return { ...view, offset: wheelOffset(view.offset, max, direction) };
}

/**
 * A list that renders only the rows in its view. Each row has a fixed height in lines. It scrolls by lines, as
 * `ScrollBody` does: Page Up/Down and the wheel move the view, and a change of the cursor brings its row into view.
 * Without a height, it renders all rows.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  cursor,
  height,
  active: enabled = true,
  wheel,
}: VirtualListProps<T>) {
  const shown = useIsActive();
  const frame = useRef<DOMElement>(null);
  const [view, setView] = useState<ViewState>({ offset: 0, revealed: "" });

  const heights = items.map((item, index) => rowHeight(item, index));
  const { total, cursorTop, cursorHeight } = measureRows(heights, cursor);
  const room = viewRoom(total, height);
  const max = room === undefined ? 0 : Math.max(0, total - room);
  // Compare the cursor of the last reveal, so that the wheel can scroll the cursor out of view, as in `ScrollBody`.
  const revealed = `${cursor}:${cursorTop}:${cursorHeight}:${room}:${max}`;
  const offset =
    view.revealed === revealed || room === undefined || cursor === undefined
      ? view.offset
      : revealOffset(view.offset, cursorTop, cursorHeight, room, max);
  const start = Math.min(offset, max);
  const range = rowsInView(heights, start, room ?? total);
  const env: PageEnv = { room: room ?? 1, max, start, setView };

  if (view.revealed !== revealed) {
    setView({ offset, revealed });
  }

  useInput((_input, key) => pageKey(env, key), { isActive: shown && enabled && max > 0 });
  useMouse(
    frame,
    { onWheel: (direction) => setView((current) => wheelView(current, max, direction)) },
    shown && (wheel ?? enabled) && max > 0,
  );

  return (
    <Box ref={frame} flexDirection="column" flexGrow={1} flexShrink={1}>
      <Box
        flexDirection="column"
        height={room === undefined ? undefined : Math.min(room, Math.max(1, total))}
        overflow="hidden"
        flexShrink={1}
      >
        <Box flexDirection="column" flexShrink={0} marginTop={-range.skip}>
          <ScrollFocusContext.Provider value={null}>
            {items.slice(range.first, range.end).map((item, i) => renderRow(item, range.first + i))}
          </ScrollFocusContext.Provider>
        </Box>
      </Box>
      {room !== undefined && max > 0 && (
        <Text color={theme.inkFaint}>
          ↑↓ {start + 1}–{Math.min(total, start + room)} of {total} · pgup/pgdn scroll
        </Text>
      )}
    </Box>
  );
}
