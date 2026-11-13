import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** The mark before the name: `›` while a row is over it, `▌` for the current entry. */
function marker(dropTarget: boolean, selected: boolean): string {
  if (dropTarget) {
    return "› ";
  }

  return selected ? "▌ " : "  ";
}

/**
 * One entry, as a row as wide as the sidebar; the current one is filled. A Board shows its `1`–`9` key.
 * With `onEdit`, a click on the `✎` at its right edge calls `onEdit` instead of `onClick`. With `drag`,
 * the row can be dragged, and its click comes on the release. With `onDrop`, another row can be dropped
 * on it; `dropTarget` shows a `›` while a row is over it.
 */
export function SidebarItem({
  index,
  name,
  selected,
  clickable,
  onClick,
  onEdit,
  drag,
  onDrop,
  onDragOver,
  onDragLeave,
  dropTarget = false,
}: {
  index?: number;
  name: string;
  selected: boolean;
  clickable: boolean;
  onClick(): void;
  onEdit?(): void;
  /** The value that a drag of this row carries. */
  drag?: unknown;
  onDrop?(value: unknown): void;
  onDragOver?(value: unknown): void;
  onDragLeave?(): void;
  dropTarget?: boolean;
}) {
  const ref = useRef<DOMElement>(null);
  const edit = useRef<DOMElement>(null);

  useMouse(ref, { onClick, drag, onDrop, onDragOver, onDragLeave }, clickable);
  useMouse(edit, { onClick: onEdit }, clickable && onEdit !== undefined);

  return (
    <Box ref={ref} width="100%" paddingRight={1} backgroundColor={selected ? theme.selection : undefined}>
      <Box flexShrink={0}>
        <Text color={theme.accent}>{marker(dropTarget, selected)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={theme.ink} bold={selected}>
          {name}
        </Text>
      </Box>
      {index !== undefined && <Text color={theme.inkFaint}>{index < 9 ? index + 1 : " "}</Text>}
      {onEdit && (
        <Box ref={edit} flexShrink={0} paddingLeft={1}>
          <Text color={selected ? theme.inkMuted : theme.inkFaint}>✎</Text>
        </Box>
      )}
    </Box>
  );
}
