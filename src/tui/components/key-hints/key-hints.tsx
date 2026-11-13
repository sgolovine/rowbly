import { Text } from "ink";
import type { KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";
import { fitHints } from "../fit-hints.js";

/**
 * A row of key hints. Given `width`, the hints that do not fit are left out from the end, keeping a
 * last `esc` hint, so the confirming key and the way back always show; the rest stay in Help.
 */
export function KeyHints({ hints, width }: { hints: readonly KeyHint[]; width?: number }) {
  const shown = width === undefined ? hints : fitHints(hints, width);
  return (
    <Text wrap="truncate-end">
      {shown.map((hint, i) => (
        <Text key={`${hint.key}:${hint.description}`}>
          {i > 0 ? "  " : ""}
          <Text bold color={theme.ink}>
            {hint.key}
          </Text>
          <Text color={theme.inkFaint}> {hint.description}</Text>
        </Text>
      ))}
    </Text>
  );
}
