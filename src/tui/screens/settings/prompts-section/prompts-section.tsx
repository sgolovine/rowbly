import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { listPrompts, type UserPrompt } from "../../../../services/prompts/prompts.js";
import { Loading } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints } from "../../../hooks/index.js";
import { type KeyHint, moveDelta } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { columnWidth } from "../column-width.js";
import { PromptFormModal } from "../prompt-form-modal/index.js";
import { PromptRow } from "../prompt-row/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";

function promptsHints(idle: boolean): KeyHint[] {
  return idle
    ? [
        { key: "↑/↓", description: "select" },
        { key: "enter", description: "edit" },
      ]
    : [];
}

/**
 * The user prompts of the project, in `.rowbly/prompts/`. `enter` or `e` edits the selected prompt, and a
 * click on a row edits its prompt. The Rowbly system prompts come first in each message, and the Stage
 * prompts are in the Stages section.
 */
export function PromptsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<UserPrompt | null>(null);
  const list = useAsync(() => listPrompts(ctx), [ctx]);

  const prompts = list.data ?? [];
  const idle = active && editing === null;

  useKeyHints(promptsHints(idle));
  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);

      if (delta !== 0) {
        setCursor((index) => Math.min(Math.max(index + delta, 0), prompts.length - 1));
      } else if ((key.return || input === "e") && prompts[cursor]) {
        setEditing(prompts[cursor]);
      }
    },
    { isActive: idle },
  );

  if (!list.data) {
    return list.loading ? <Loading label="Loading prompts…" /> : null;
  }

  const labelWidth = columnWidth(
    prompts.map((prompt) => prompt.label),
    2,
  );

  return (
    <Box flexDirection="column">
      {prompts.map((prompt, index) => (
        <PromptRow
          key={prompt.name}
          prompt={prompt}
          selected={index === cursor}
          idle={idle}
          labelWidth={labelWidth}
          onClick={() => {
            setCursor(index);
            setEditing(prompt);
          }}
        />
      ))}
      <Box marginTop={1}>
        <Text color={theme.inkFaint} wrap="wrap">
          Rowbly puts its system prompts before these prompts. Edit the prompt of each Stage in Stages.
        </Text>
      </Box>
      {editing && (
        <PromptFormModal
          ctx={ctx}
          prompt={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
            onChange();
          }}
        />
      )}
    </Box>
  );
}
