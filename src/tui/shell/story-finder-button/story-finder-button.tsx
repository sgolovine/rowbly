import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** A field-like entry point to the Story finder in the header. The input itself is in the finder. */
export function StoryFinderButton({
  compact,
  clickable,
  onClick,
}: {
  /** Shows only the glyph, for a narrow header. */
  compact: boolean;
  clickable: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, clickable);

  return (
    <Box ref={ref} backgroundColor={theme.field} paddingX={1} flexShrink={0}>
      <Text color={theme.inkMuted}>{compact ? "🔎" : "🔎 Find Stories  "}</Text>
      {!compact && (
        <Text color={theme.inkMuted} backgroundColor={theme.keycap}>
          {" "}
          ctrl+p{" "}
        </Text>
      )}
    </Box>
  );
}
