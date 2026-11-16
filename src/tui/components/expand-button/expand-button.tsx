import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useIsActive, useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

interface ExpandButtonProps {
  /** The region is expanded: the button shows the collapse icon. */
  readonly expanded: boolean;
  onClick(): void;
}

/** A clickable `⤢` (expand) or `⤡` (collapse), set into a border beside the `✕` of the region that it frames. */
export function ExpandButton({ expanded, onClick }: ExpandButtonProps) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, useIsActive());

  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={theme.inkFaint}>{expanded ? " ⤡ " : " ⤢ "}</Text>
    </Box>
  );
}
