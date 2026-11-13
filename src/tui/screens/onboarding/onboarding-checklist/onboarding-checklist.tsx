import { Box, Text } from "ink";
import { type SelectItem, SelectList, TextInput } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { type ChecklistAdd, useOnboardingChecklist } from "./use-onboarding-checklist.js";

export interface OnboardingChecklistProps {
  heading: string;
  description: string;
  items: readonly SelectItem[];
  selected: readonly string[];
  /** Shown when `enter` is pressed with nothing checked. Leave out if an empty list is valid. */
  emptyError?: string;
  /** Lets the user add a row with `n`. */
  add?: ChecklistAdd;
  onSubmit(values: string[]): void;
  onBack(): void;
  onHints(hints: readonly KeyHint[]): void;
}

/** One onboarding step that picks from a list, on the screen. `space` toggles, `enter` goes on, `esc` goes back. */
export function OnboardingChecklist({
  heading,
  description,
  items,
  selected,
  emptyError,
  add,
  onSubmit,
  onBack,
  onHints,
}: OnboardingChecklistProps) {
  const model = useOnboardingChecklist({ items, selected, emptyError, add, onSubmit, onBack, onHints });

  return (
    <Box flexDirection="column">
      <Text bold color={theme.ink}>
        {heading}
      </Text>
      <Text color={theme.inkFaint}>{description}</Text>
      <Box marginTop={1} flexDirection="column">
        <SelectList
          // A new row must be checked, and the list keeps its own selection.
          key={items.length}
          items={items}
          multi
          defaultSelected={model.checked}
          defaultIndex={Math.min(model.cursor, Math.max(0, items.length - 1))}
          limit={model.limit}
          isActive={!model.adding}
          onChange={model.change}
          onHighlight={model.highlight}
          onFilteringChange={model.setFiltering}
          onSubmit={model.submit}
        />
      </Box>
      {add && model.adding && (
        <Box marginTop={1} gap={1}>
          <Text color={theme.accent}>{add.label}:</Text>
          <TextInput value={model.text} onChange={model.setText} focus={model.active} />
        </Box>
      )}
      {model.error && <Text color={theme.danger}>{model.error}</Text>}
    </Box>
  );
}
