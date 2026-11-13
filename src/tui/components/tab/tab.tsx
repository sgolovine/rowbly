import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** One tab of `Tabs`: the selected tab is on the `accent` fill. A click selects it. */
export function Tab({
  label,
  selected,
  active,
  onClick,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, active);

  return (
    <Box ref={ref}>
      <Text
        backgroundColor={selected ? theme.accent : undefined}
        color={selected ? theme.onAccent : theme.inkMuted}
        bold={selected}
      >
        {` ${label} `}
      </Text>
    </Box>
  );
}
