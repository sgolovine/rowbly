import { Box, type DOMElement, Text } from "ink";
import { type ReactNode, useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { useScrollFocus } from "../scrollFocus.js";

/** What a `SelectionRow` does in a drag and drop with the mouse. */
export interface RowDragProps {
  /** The value that a drag of this row carries. With `drag`, the click of the row comes on the release. */
  drag?: unknown;
  /** A dragged `value` was released over this row. */
  onDrop?(value: unknown): void;
  /** A drag that carries `value` is over this row. */
  onDragOver?(value: unknown): void;
  onDragLeave?(): void;
}

/** Shared selection bar and fill, including focus-following scroll and an optional mouse target. */
export function SelectionRow({
  selected,
  active,
  onClick,
  drag,
  onDrop,
  onDragOver,
  onDragLeave,
  children,
}: {
  selected: boolean;
  active: boolean;
  onClick?(): void;
  children: ReactNode;
} & RowDragProps) {
  const ref = useRef<DOMElement>(null);
  useScrollFocus(ref, selected && active);
  useMouse(
    ref,
    { onClick, drag, onDrop, onDragOver, onDragLeave },
    active && (onClick !== undefined || drag !== undefined || onDrop !== undefined),
  );
  return (
    <Box ref={ref} backgroundColor={selected ? theme.selection : undefined}>
      <Box flexShrink={0}>
        <Text color={theme.accent}>{selected ? "▌ " : "  "}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  );
}
