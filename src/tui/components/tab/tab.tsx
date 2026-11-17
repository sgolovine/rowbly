import { Box, type DOMElement, Text } from "ink";
import { useRef } from "react";
import { useMouse } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** The look of a `Tab`. */
type TabVariant = "accent" | "subtle";

/** The colors of a selected and a not selected tab, for each variant. */
const VARIANT_COLORS: Record<
  TabVariant,
  {
    selected: { backgroundColor?: string; color?: string };
    unselected: { backgroundColor?: string; color?: string };
  }
> = {
  accent: { selected: { backgroundColor: theme.accent, color: theme.onAccent }, unselected: { color: theme.inkMuted } },
  subtle: { selected: { backgroundColor: theme.selection }, unselected: {} },
};

/**
 * One clickable tab. A click selects it. The selected tab is bold.
 *
 * - `accent` (the default, used by `Tabs`): the selected tab is on the `accent` fill; the other tabs are muted.
 * - `subtle` (the `View` and `Edit` tabs of a `FullScreenEditor`): the selected tab is on the `selection` fill;
 *   the other tabs have the default text color.
 */
export function Tab({
  label,
  selected,
  active,
  variant = "accent",
  onClick,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  variant?: TabVariant;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  const colors = VARIANT_COLORS[variant];
  const { backgroundColor, color } = selected ? colors.selected : colors.unselected;

  useMouse(ref, { onClick }, active);

  return (
    <Box ref={ref} flexShrink={0}>
      <Text backgroundColor={backgroundColor} color={color} bold={selected}>
        {` ${label} `}
      </Text>
    </Box>
  );
}
