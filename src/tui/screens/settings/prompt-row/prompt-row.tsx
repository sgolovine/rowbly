import { Box, Text } from "ink";
import { PROMPT_AUDIENCE, type UserPrompt } from "../../../../services/prompts/prompts.js";
import { SelectionRow } from "../../../components/index.js";
import { theme } from "../../../theme.js";

/** The props of `PromptRow`. */
export interface PromptRowProps {
  readonly prompt: UserPrompt;
  readonly selected: boolean;
  /** False while a Form has the keys; then the row does not take a click. */
  readonly idle: boolean;
  /** The column of the label, so that the rows line up. */
  readonly labelWidth: number;
  readonly onClick: () => void;
}

/** The state of the prompt file: missing, empty, or its number of lines. */
export function promptState(prompt: UserPrompt): string {
  if (!prompt.exists) {
    return "missing";
  }

  if (!prompt.text) {
    return "empty";
  }

  const lines = prompt.text.split("\n").length;

  return lines === 1 ? "1 line" : `${lines} lines`;
}

/** One user prompt in the settings list: its label, the state of its file, and the agents that get it. */
export function PromptRow({ prompt, selected, idle, labelWidth, onClick }: PromptRowProps) {
  return (
    <SelectionRow selected={selected} active={idle} onClick={onClick}>
      <Box>
        <Box width={labelWidth} flexShrink={0}>
          <Text color={selected ? theme.ink : theme.inkMuted}>{prompt.label}</Text>
        </Box>
        <Box width={10} flexShrink={0}>
          <Text color={prompt.text ? theme.inkMuted : theme.inkFaint}>{promptState(prompt)}</Text>
        </Box>
        <Text color={theme.inkFaint} wrap="truncate-end">
          {PROMPT_AUDIENCE[prompt.name]}
        </Text>
      </Box>
    </SelectionRow>
  );
}
