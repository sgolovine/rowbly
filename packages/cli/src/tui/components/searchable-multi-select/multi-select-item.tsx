import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** One chosen option of a `SearchableMultiSelect`: its label, and a `✕` that removes it when you click it. */
export function MultiSelectItem({
  label,
  highlighted,
  clickable,
  onRemove,
}: {
  label: string;
  highlighted: boolean;
  clickable: boolean;
  onRemove(): void;
}) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick: onRemove }, clickable);

  return (
    <Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" underline={highlighted}>
          {label}
        </Text>
      </Box>
      <Box ref={ref} flexShrink={0} paddingLeft={1}>
        <Text color={highlighted ? theme.inkMuted : theme.inkFaint}>✕</Text>
      </Box>
    </Box>
  );
}
