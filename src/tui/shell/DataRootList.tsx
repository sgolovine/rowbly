import { Box, type DOMElement, type Key, Text, useInput } from 'ink';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { KnownDataRootChoice } from '../../services';
import { TextInput } from '../components';
import { useKeyCapture, useLayout, useMouse, WHEEL_LINES } from '../hooks';
import { theme } from '../theme';
import { searchDataRoots } from './dataRootSearch';

/** A key that types text, as opposed to one that moves, confirms or closes. */
function printable(input: string, key: Key): boolean {
  if (key.ctrl || key.meta || key.return || key.escape || key.tab || key.backspace || key.delete) return false;
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not text.
  return input.length > 0 && !/[\u0000-\u001f\u007f]/.test(input);
}

/**
 * **+ New Data Root** pinned at the top, whatever the query, then a search line and the known Data
 * Roots (ADR-0056). Typing a key the screen does not use (`actionKey`) or `/` starts the search; while
 * it is focused every printable key is text and `esc` clears and leaves it. Each change to the query
 * highlights the best match, or **+ New Data Root** when nothing matches. `↑/↓` move, `enter` or a
 * click picks (`null` is **+ New Data Root**). The query is the parent's (`null` while the search is
 * not focused), so its own keys can wait. With more than `limit` matches the Data Roots scroll below
 * the button, and the mouse wheel moves the highlight.
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
  limit = Number.POSITIVE_INFINITY,
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
  limit?: number;
}) {
  const { width } = useLayout();
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
      else if (key.return) onPick(highlighted);
      else if (searching) {
        if (key.escape) search(null);
      } else if (input === '/' && !key.ctrl && !key.meta) search('');
      else if (printable(input, key) && !actionKey(input, key)) search(input);
    },
    { isActive: active },
  );

  const rowList = useRef<DOMElement>(null);
  useMouse(
    rowList,
    {
      onWheel: (direction) => setCursor((current) => clamp(clamp(current) + direction * WHEEL_LINES)),
    },
    active && results.length > limit,
  );
  const shown = Math.min(limit, results.length);
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
      <Box marginBottom={1}>{newRow(index === -1, click(-1, null))}</Box>
      <Box backgroundColor={searching ? theme.fieldFocus : theme.field} paddingX={1} marginBottom={1}>
        <Text color={theme.accent}>/ </Text>
        <TextInput
          value={query ?? ''}
          onChange={search}
          focus={active && searching}
          width={Math.max(8, width - 6)}
          placeholder="Type to search…"
        />
      </Box>
      <Box ref={rowList} flexDirection="column">
        {results.slice(start, start + shown).map((root, i) => (
          <Box key={root.path}>{renderRow(root, start + i === index, click(start + i, root))}</Box>
        ))}
      </Box>
      {searching && query.trim() && results.length === 0 && (
        <Text color={theme.inkFaint}>{'  '}No matching Data Roots.</Text>
      )}
      {results.length > 0 && (results.length > shown || query?.trim()) && (
        <Text color={theme.inkFaint}>{`  ${index + 1}/${results.length}`}</Text>
      )}
    </Box>
  );
}
