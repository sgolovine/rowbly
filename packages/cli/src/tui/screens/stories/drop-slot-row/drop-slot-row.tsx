import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

/**
 * The drop shadow of the Story list: one empty row filled in `dropTarget`, between the rows where a dragged
 * Story lands on release. It is a drop target too, so the pointer can rest on it.
 */
export function DropSlotRow({
  clickable,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  clickable: boolean;
  onDragOver(value: unknown): void;
  onDragLeave(): void;
  onDrop(value: unknown): void;
}) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onDrop, onDragOver, onDragLeave }, clickable);

  return (
    <Box ref={ref} width="100%" backgroundColor={theme.dropTarget}>
      <Text> </Text>
    </Box>
  );
}
