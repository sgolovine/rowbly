import { Box, Text, useInput } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { useIsActive } from '../hooks';
import { moveDelta } from '../keymap';
import { theme } from '../theme';
import { loadMarkdownRenderer, markdownRenderer, plainMarkdownRows } from './markdown';

export interface MarkdownViewProps {
  /** Markdown source. */
  text: string;
  /** Columns available; the text is laid out to fit. */
  width: number;
  /** Rows available, including the scroll position row; without it the whole text shows. */
  height?: number;
  /** Takes `↑/↓` (and `j/k`) to scroll. Defaults to true. */
  active?: boolean;
  /** Shown dimmed when the text is empty. */
  emptyText?: string;
}

/**
 * Markdown rendered for the terminal in a scrolling viewport: `↑/↓` (or `j/k`) scroll, and a row
 * under the text shows the position when it does not all fit. The first time one is shown, the text
 * shows without its markdown syntax until the renderer has loaded.
 */
export function MarkdownView({
  text,
  width,
  height,
  active = true,
  emptyText = 'Nothing here yet.',
}: MarkdownViewProps) {
  const isActive = useIsActive() && active;
  const [offset, setOffset] = useState(0);
  const [render, setRender] = useState(markdownRenderer);
  useEffect(() => {
    if (render) return;
    let current = true;
    void loadMarkdownRenderer().then((loaded) => current && setRender(() => loaded));
    return () => {
      current = false;
    };
  }, [render]);
  const lines = useMemo(() => (render ?? plainMarkdownRows)(text, width), [render, text, width]);
  const fits = height === undefined || lines.length <= height;
  // One row is kept for the position when the text scrolls.
  const rows = fits ? lines.length : Math.max(1, height - 1);
  const max = Math.max(0, lines.length - rows);
  const start = Math.min(offset, max);
  useInput(
    (input, key) => {
      const delta = key.pageUp ? -rows : key.pageDown ? rows : moveDelta(input, key);
      if (delta) setOffset(Math.max(0, Math.min(max, start + delta)));
    },
    { isActive: isActive && max > 0 },
  );
  if (!text.trim()) return <Text color={theme.inkFaint}>{emptyText}</Text>;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.slice(start, start + rows).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
        <Text key={i} wrap="truncate-end">
          {/* An empty Text has no height, so a blank line holds a space to keep its row. */}
          {line || ' '}
        </Text>
      ))}
      {max > 0 && (
        <Text
          color={theme.inkFaint}
        >{`${start + 1}–${Math.min(lines.length, start + rows)} of ${lines.length} · ↑/↓ scroll`}</Text>
      )}
    </Box>
  );
}
