import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useIsActive, useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

interface BorderIconProps {
  /** The glyph to show, for example `✕`, `⤢` or `⤡`. The icon adds one space on each side. */
  readonly glyph: string;
  onClick(): void;
}

/** A clickable glyph set into a border, for example the `✕` that closes what the border frames. */
export function BorderIcon({ glyph, onClick }: BorderIconProps) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, useIsActive());

  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={theme.inkFaint}>{` ${glyph} `}</Text>
    </Box>
  );
}
