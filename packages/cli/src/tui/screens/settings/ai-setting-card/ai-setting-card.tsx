import { Box, Text } from "ink";
import { Button } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The props of `AiSettingCard`. */
export interface AiSettingCardProps {
  readonly title: string;
  /** The current value, or `—` before it loads. */
  readonly value: string;
  /** What the setting does, in one sentence. */
  readonly description: string;
  /** The label of the edit Button. Without it, the card has no Button, for example before Pi loads. */
  readonly action?: string;
  /** The key that does the same as the Button. */
  readonly keyName: string;
  /** False while a task on top has the keys; then the Button does not take a click. */
  readonly clickable: boolean;
  readonly onEdit: () => void;
}

/**
 * One factory setting in its own frame: the name and the edit Button with its key on the first row, the value
 * on the next row, and what the setting does under it.
 */
export function AiSettingCard({ title, value, description, action, keyName, clickable, onEdit }: AiSettingCardProps) {
  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box justifyContent="space-between" gap={1}>
        <Text bold color={theme.ink}>
          {title}
        </Text>
        {action && <Button label={action} keyName={keyName} compact clickable={clickable} onClick={onEdit} />}
      </Box>
      <Text color={value === "—" ? theme.inkFaint : theme.ink}>{value}</Text>
      <Text color={theme.inkFaint} wrap="wrap">
        {description}
      </Text>
    </Box>
  );
}
