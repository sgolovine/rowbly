import { Box, Text } from "ink";
import pkg from "../../../../package.json" with { type: "json" };
import type { KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";
import { KeyHints } from "../KeyHints/index.js";

/**
 * The bottom row of the shell: the keys of the screen in focus on the left (secondary ones stay in
 * Help), `? help` and, at the root, `q quit` pinned right with the version.
 */
export function Footer({ hints, atRoot }: { hints: readonly KeyHint[]; atRoot: boolean }) {
  return (
    <Box paddingX={1} flexShrink={0} columnGap={2} justifyContent="space-between">
      <KeyHints hints={hints.filter((hint) => !hint.secondary)} />
      <Box flexShrink={0} columnGap={2}>
        <KeyHints hints={[{ key: "?", description: "help" }, ...(atRoot ? [{ key: "q", description: "quit" }] : [])]} />
        <Text color={theme.inkFaint}>v{pkg.version}</Text>
      </Box>
    </Box>
  );
}
