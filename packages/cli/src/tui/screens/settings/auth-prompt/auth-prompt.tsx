import { Box, Text } from "ink";
import { SelectList, TextInput } from "../../../components/index.js";
import { ActiveContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { Pending } from "../auth-types.js";

/** The props of `AuthPromptView`. */
export interface AuthPromptViewProps {
  readonly pending: Pending;
  readonly text: string;
  readonly onText: (text: string) => void;
  /** The columns of the Modal around the prompt. */
  readonly width: number;
  readonly active: boolean;
}

/** A question of a provider: a choice in a list, or a line of text. A secret shows each character as `•`. */
export function AuthPromptView({ pending, text, onText, width, active }: AuthPromptViewProps) {
  return (
    <Box flexDirection="column">
      <Text color={theme.ink} wrap="wrap">
        {pending.prompt.message}
      </Text>
      {pending.prompt.type === "select" ? (
        <ActiveContext.Provider value={active}>
          <SelectList
            items={pending.prompt.options.map((option) => ({
              value: option.id,
              label: option.label,
              description: option.description,
            }))}
            onSelect={(item) => pending.resolve(item.value)}
          />
        </ActiveContext.Provider>
      ) : (
        <Box backgroundColor={theme.fieldFocus} paddingX={1}>
          <Text color={theme.accent}>› </Text>
          <TextInput
            value={text}
            onChange={onText}
            width={width - 6}
            mask={pending.prompt.type === "secret"}
            placeholder={pending.prompt.placeholder}
          />
        </Box>
      )}
    </Box>
  );
}
