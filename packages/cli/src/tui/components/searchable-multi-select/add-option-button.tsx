import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** The `+ add` line under the chosen options of a `SearchableMultiSelect`. A click opens the picker. */
export function AddOptionButton({ clickable, onClick }: { clickable: boolean; onClick(): void }) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, clickable);

  return (
    <Box ref={ref}>
      <Text color={theme.inkFaint}>+ add</Text>
    </Box>
  );
}
