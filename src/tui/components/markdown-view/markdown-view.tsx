import { Box, type DOMElement, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from "react";
import { useIsActive, useMouse } from "../../hooks/index.js";
import { moveDelta } from "../../keymap.js";
import { theme } from "../../theme.js";
import { plainMarkdownRows } from "../markdown.js";
import { clampOffset, wheelOffset } from "../scroll-offset.js";
import { useMarkdownRenderer } from "../use-markdown-renderer.js";

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

/** The rows of the text in view, and the setter of the first row. */
interface ScrollEnv {
  readonly rows: number;
  readonly max: number;
  readonly start: number;
  readonly setOffset: Dispatch<SetStateAction<number>>;
}

/** The rows that a key scrolls: a page for `pgup/pgdn`, otherwise one row for `↑/↓` or `j/k`. */
function keyDelta(rows: number, input: string, key: Key): number {
  if (key.pageUp) {
    return -rows;
  }

  return key.pageDown ? rows : moveDelta(input, key);
}

function scrollKey(env: ScrollEnv, input: string, key: Key): void {
  const delta = keyDelta(env.rows, input, key);

  if (delta) {
    env.setOffset(clampOffset(env.start + delta, env.max));
  }
}

/**
 * Markdown rendered for the terminal in a scrolling viewport: `↑/↓` (or `j/k`) and the mouse wheel scroll, and a row
 * under the text shows the position when it does not all fit. The first time one is shown, the text
 * shows without its markdown syntax until the renderer has loaded.
 */
export function MarkdownView({
  text,
  width,
  height,
  active = true,
  emptyText = "Nothing here yet.",
}: MarkdownViewProps) {
  const isActive = useIsActive() && active;
  const [offset, setOffset] = useState(0);
  const render = useMarkdownRenderer();
  const lines = useMemo(() => (render ?? plainMarkdownRows)(text, width), [render, text, width]);
  const ref = useRef<DOMElement>(null);

  const fits = height === undefined || lines.length <= height;
  // One row is kept for the position when the text scrolls.
  const rows = fits ? lines.length : Math.max(1, height - 1);
  const max = Math.max(0, lines.length - rows);
  const start = Math.min(offset, max);
  const env: ScrollEnv = { rows, max, start, setOffset };

  useInput((input, key) => scrollKey(env, input, key), { isActive: isActive && max > 0 });
  useMouse(
    ref,
    { onWheel: (direction) => setOffset((current) => wheelOffset(current, max, direction)) },
    isActive && max > 0,
  );

  if (!text.trim()) {
    return <Text color={theme.inkFaint}>{emptyText}</Text>;
  }

  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      {lines.slice(start, start + rows).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
        <Text key={i} wrap="truncate-end">
          {/* An empty Text has no height, so a blank line holds a space to keep its row. */}
          {line || " "}
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
