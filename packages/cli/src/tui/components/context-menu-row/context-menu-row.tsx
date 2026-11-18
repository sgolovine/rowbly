import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import type { ContextMenuItem } from "../context-menu/context-menu-view.js";

export interface ContextMenuRowProps {
  readonly item: ContextMenuItem;
  readonly highlighted: boolean;
  readonly active: boolean;
  /** The pointer moved onto the row. */
  onPoint(): void;
  /** A click on the row. */
  onRun(): void;
}

/** The colour of the label: `ink`, or `ink-faint` for an item that does not apply. */
function labelColor(item: ContextMenuItem): string {
  return item.disabled ? theme.inkFaint : theme.ink;
}

/**
 * One item of a `ContextMenu`: the `▌` bar and the `selection` fill when highlighted, the label, and the key of the item
 * right-aligned in `ink-muted`. A right click on the row does nothing.
 */
export function ContextMenuRow({ item, highlighted, active, onPoint, onRun }: ContextMenuRowProps) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick: onRun, onEnter: onPoint, onMenu: () => undefined }, active);

  return (
    <Box ref={ref} backgroundColor={highlighted ? theme.selection : undefined} paddingRight={1}>
      <Box flexShrink={0}>
        <Text color={theme.accent}>{highlighted ? "▌ " : "  "}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={labelColor(item)} bold={highlighted} wrap="truncate-end">
          {item.label}
        </Text>
      </Box>
      {item.keyName && (
        <Box flexShrink={0} paddingLeft={2}>
          <Text color={theme.inkMuted}>{item.keyName}</Text>
        </Box>
      )}
    </Box>
  );
}
