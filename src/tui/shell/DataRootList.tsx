import { Box, type DOMElement, type Key, measureElement, Text, useBoxMetrics, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnownDataRootChoice } from '../../services';
import { ScrollFocusContext, TextInput } from '../components';
import { MouseClipContext, useKeyCapture, useLayout, useMouse, WHEEL_LINES } from '../hooks';
import { theme } from '../theme';
import { searchDataRoots } from './dataRootSearch';

/** A key that types text, as opposed to one that moves, confirms or closes. */
function printable(input: string, key: Key): boolean {
  if (key.ctrl || key.meta || key.return || key.escape || key.tab || key.backspace || key.delete) return false;
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not text.
  return input.length > 0 && !/[\u0000-\u001f\u007f]/.test(input);
}

/** The fewest lines left for the Data Roots before the gaps below the button and the search line go. */
const MIN_ROOT_LINES = 3;

/**
 * **+ New Data Root** pinned at the top, whatever the query, then a search line and the known Data
 * Roots (ADR-0056). Typing a key the screen does not use (`actionKey`) or `/` starts the search; while
 * it is focused every printable key is text and `esc` clears and leaves it. Each change to the query
 * highlights the best match, or **+ New Data Root** when nothing matches. `↑/↓` move, `enter` or a
 * click picks (`null` is **+ New Data Root**). The query is the parent's (`null` while the search is
 * not focused), so its own keys can wait. With more than `limit` matches the Data Roots scroll below
 * the button: `page up/down` and the mouse wheel move the highlight. Without a `limit`, the list takes
 * the layout's height at most and the Data Roots scroll in the room the button and the search line
 * leave, measured as they are drawn, so wrapped rows fit and a modal around it never scrolls the
 * button away.
 */
export function DataRootList({
  roots,
  home,
  active,
  query,
  onQueryChange,
  initial,
  actionKey,
  onHighlight,
  onPick,
  renderRow,
  newRow,
  limit,
  below = 0,
}: {
  roots: readonly KnownDataRootChoice[];
  home: string;
  /** Takes keys and clicks. */
  active: boolean;
  query: string | null;
  onQueryChange(query: string | null): void;
  /** The path of the Data Root to highlight first; else the first Data Root, or the button without any. */
  initial?: string;
  /** A key the screen acts on while the search is not focused, so it does not start one. */
  actionKey(input: string, key: Key): boolean;
  /** The highlighted Data Root, or `null` on **+ New Data Root**. */
  onHighlight?(root: KnownDataRootChoice | null): void;
  onPick(root: KnownDataRootChoice | null): void;
  renderRow(root: KnownDataRootChoice, highlighted: boolean, onClick: (() => void) | undefined): ReactNode;
  newRow(highlighted: boolean, onClick: (() => void) | undefined): ReactNode;
  /** The most Data Roots shown at once; by default, as many as fit the layout's height. */
  limit?: number;
  /** The lines the screen shows below the list, inside the same height. */
  below?: number;
}) {
  const { width, height } = useLayout();
  const searching = query !== null;
  const results = useMemo(() => searchDataRoots(roots, query ?? '', home), [roots, query, home]);
  // The highlighted Data Root's index; -1 is **+ New Data Root**, above them. Kept across a remount,
  // such as after an edit modal, through `initial`.
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      results.findIndex((root) => root.path === initial),
    ),
  );
  const clamp = (at: number) => Math.max(-1, Math.min(results.length - 1, at));
  const counted = !!query?.trim() && results.length > 0;
  const unmatched = searching && !!query.trim() && results.length === 0;

  // Without a `limit` in a known height, every Data Root is drawn in a viewport that scrolls to the
  // highlighted row, as `ScrollBody` does, and the button and the search line stay above it.
  const rowList = useRef<DOMElement>(null);
  const viewport = useRef<DOMElement>(null);
  const { height: lines } = useBoxMetrics(rowList);
  const [offset, setOffset] = useState(0);
  const space = limit === undefined && height !== undefined ? Math.max(0, height - below) : undefined;
  // The line below the Data Roots: their count, or that none match.
  const footer = counted || unmatched ? 1 : 0;
  const gaps = space === undefined || space - 4 - footer >= MIN_ROOT_LINES;
  const left = space === undefined ? undefined : Math.max(0, space - (gaps ? 4 : 2));
  const room = left === undefined ? undefined : Math.max(0, left - Math.max(footer, lines > left ? 1 : 0));
  const max = room === undefined ? 0 : Math.max(0, lines - room);
  const top = Math.min(offset, max);
  const reveal = useCallback(
    (node: DOMElement) => {
      if (!viewport.current || room === undefined) return;
      const target = measureElement(node);
      const view = measureElement(viewport.current);
      const delta =
        target.y < view.y
          ? target.y - view.y
          : target.y + target.height > view.y + room
            ? target.y + target.height - view.y - room
            : 0;
      if (delta) setOffset((current) => Math.max(0, Math.min(max, Math.min(current, max) + delta)));
    },
    [max, room],
  );
  // The Data Roots a page holds: `limit`, or as many as fit the viewport at their average height.
  const rows =
    limit ??
    (room === undefined || results.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor((room * results.length) / Math.max(1, lines))));

  const index = clamp(cursor);
  const highlighted = results[index] ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the highlighted row changes.
  useEffect(() => onHighlight?.(highlighted), [highlighted]);
  useKeyCapture(active && searching, { escape: true });

  const move = (delta: number) => setCursor(clamp(index + delta));
  const search = (text: string | null) => {
    onQueryChange(text);
    setCursor(0);
  };
  useInput(
    (input, key) => {
      if (key.upArrow) move(-1);
      else if (key.downArrow) move(1);
      else if (key.pageUp || key.pageDown) move((key.pageUp ? -1 : 1) * Math.max(1, Math.min(rows, results.length)));
      else if (key.return) onPick(highlighted);
      else if (searching) {
        if (key.escape) search(null);
      } else if (input === '/' && !key.ctrl && !key.meta) search('');
      else if (printable(input, key) && !actionKey(input, key)) search(input);
    },
    { isActive: active },
  );

  useMouse(
    viewport,
    {
      onWheel: (direction) => setCursor((current) => clamp(clamp(current) + direction * WHEEL_LINES)),
    },
    active && (room === undefined ? results.length > rows : max > 0),
  );
  const shown = room === undefined ? Math.min(rows, results.length) : results.length;
  const start = Math.max(0, Math.min(index - Math.floor(shown / 2), results.length - shown));
  const click = (at: number, root: KnownDataRootChoice | null) =>
    active
      ? () => {
          setCursor(at);
          onPick(root);
        }
      : undefined;

  return (
    // The full width, so a modal around it keeps its size as the matches change.
    <Box flexDirection="column" width={width}>
      <Box marginBottom={gaps ? 1 : 0} flexShrink={0}>
        {newRow(index === -1, click(-1, null))}
      </Box>
      <Box
        backgroundColor={searching ? theme.fieldFocus : theme.field}
        paddingX={1}
        marginBottom={gaps ? 1 : 0}
        flexShrink={0}
      >
        <Text color={theme.accent}>/ </Text>
        <TextInput
          value={query ?? ''}
          onChange={search}
          focus={active && searching}
          width={Math.max(8, width - 6)}
          placeholder="Type to search…"
        />
      </Box>
      <Box
        ref={viewport}
        flexDirection="column"
        flexShrink={0}
        height={room === undefined ? undefined : Math.min(room, Math.max(1, lines))}
        overflow={room === undefined ? undefined : 'hidden'}
      >
        <Box ref={rowList} flexDirection="column" flexShrink={0} marginTop={-top}>
          <ScrollFocusContext.Provider value={room === undefined ? null : reveal}>
            <MouseClipContext.Provider value={viewport}>
              {results.slice(start, start + shown).map((root, i) => (
                <Box key={root.path}>{renderRow(root, start + i === index, click(start + i, root))}</Box>
              ))}
            </MouseClipContext.Provider>
          </ScrollFocusContext.Provider>
        </Box>
      </Box>
      {unmatched && <Text color={theme.inkFaint}>{'  '}No matching Data Roots.</Text>}
      {(counted || (results.length > 0 && (room === undefined ? results.length > shown : max > 0))) && (
        <Text color={theme.inkFaint}>{`  ${index + 1}/${results.length}`}</Text>
      )}
    </Box>
  );
}
