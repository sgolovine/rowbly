import { Text } from "ink";
import { PROMPT_AUDIENCE, type UserPrompt } from "../../../../services/prompts/prompts.js";
import { ColumnRow } from "../../../components/index.js";
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
function promptState(prompt: UserPrompt): string {
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
    <ColumnRow
      selected={selected}
      active={idle}
      onClick={onClick}
      columns={[
        { width: labelWidth, content: <Text color={selected ? theme.ink : theme.inkMuted}>{prompt.label}</Text> },
        {
          width: 10,
          content: <Text color={prompt.text ? theme.inkMuted : theme.inkFaint}>{promptState(prompt)}</Text>,
        },
        {
          content: (
            <Text color={theme.inkFaint} wrap="truncate-end">
              {PROMPT_AUDIENCE[prompt.name]}
            </Text>
          ),
        },
      ]}
    />
  );
}
