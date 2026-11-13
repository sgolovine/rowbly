import { Box, Text } from "ink";
import { theme } from "../../theme.js";
import type { ConversationLine, ConversationTone } from "../conversation-lines.js";

const INK: Record<ConversationTone, string> = {
  label: theme.inkMuted,
  body: theme.ink,
  quiet: theme.inkFaint,
  error: theme.danger,
};

/**
 * The rows of one conversation entry that are in view: the label in bold `ink-muted` with its time in
 * `ink-faint`, the body in `ink`, quiet rows in `ink-faint` and errors in `danger`. `conversationLines` makes
 * the rows; this component only draws them, so a viewport can draw a part of an entry.
 */
export function ConversationEntry({ lines }: { lines: readonly ConversationLine[] }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
        <Text key={i} wrap="truncate-end" color={INK[line.tone]} bold={line.tone === "label"}>
          {/* An empty Text has no height, so a blank row holds a space to keep its row. */}
          {line.text || " "}
          {line.meta && (
            <Text color={theme.inkFaint} bold={false}>
              {" "}
              · {line.meta}
            </Text>
          )}
          {line.alert && <Text color={theme.danger}> · {line.alert}</Text>}
        </Text>
      ))}
    </Box>
  );
}
