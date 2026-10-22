import { Box, type DOMElement, useInput, useWindowSize } from 'ink';
import { useRef, useState } from 'react';
import { type ContextMenuItem, useMouse } from '../hooks';
import { moveDelta } from '../keymap';
import { theme } from '../theme';
import { ContextMenuRow } from './ContextMenuRow';

export interface ContextMenuProps {
  /** The cell it opens at, 0-based: usually where the right click landed. */
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose(): void;
}

/** The next item from `from` in direction `delta` that is not disabled, or `from` when there is none. */
function step(items: readonly ContextMenuItem[], from: number, delta: number): number {
  for (let at = from + delta; at >= 0 && at < items.length; at += delta) {
    if (!items[at]?.disabled) return at;
  }
  return from;
}

/**
 * A framed list of actions drawn over the whole terminal with its top-left corner at `x`, `y`, moved
 * in so that it stays on screen. `↑/↓` (or `j/k`) highlight an item, `enter` or a click runs it and
 * `esc` closes the menu. A click or right click outside the menu only closes it: the box underneath
 * does not get it.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const { columns, rows } = useWindowSize();
  const [cursor, setCursor] = useState(() => step(items, -1, 1));
  const run = (item: ContextMenuItem | undefined) => {
    if (!item || item.disabled) return;
    onClose();
    item.onSelect();
  };
  useInput((input, key) => {
    const delta = moveDelta(input, key);
    if (key.escape) onClose();
    else if (key.return) run(items[cursor]);
    else if (delta) setCursor(step(items, cursor, delta));
  });

  // Over everything but the menu: a click or right click there closes the menu.
  const backdrop = useRef<DOMElement>(null);
  useMouse(backdrop, { onClick: onClose, onContextMenu: onClose, layer: 1 });
  // The frame takes clicks that miss an item, so they do not reach the backdrop.
  const frame = useRef<DOMElement>(null);
  useMouse(frame, { onClick: () => {}, onContextMenu: () => {}, layer: 1 });

  // `▌ `, the label, two spaces before the longest key, and a space at the end.
  const keys = Math.max(0, ...items.map((item) => item.key?.length ?? 0));
  const inner = Math.max(...items.map((item) => item.label.length)) + 3 + (keys > 0 ? keys + 2 : 0);
  const width = inner + 2;
  const height = items.length + 2;
  return (
    <Box position="absolute" top={0} left={0} width={columns} height={rows}>
      <Box ref={backdrop} position="absolute" top={0} left={0} width={columns} height={rows} />
      <Box
        ref={frame}
        position="absolute"
        top={Math.max(0, Math.min(y, rows - height))}
        left={Math.max(0, Math.min(x, columns - width))}
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={theme.accent}
        backgroundColor={theme.overlay}
      >
        {items.map((item, i) => (
          <ContextMenuRow
            key={item.label}
            item={item}
            width={inner}
            highlighted={i === cursor}
            onHover={() => {
              if (!item.disabled) setCursor(i);
            }}
            onClick={() => run(item)}
          />
        ))}
      </Box>
    </Box>
  );
}
