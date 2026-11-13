import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { type SelectItem, SelectList, TextInput } from "../../../components/index.js";
import { useIsActive, useLayout } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { useStepHints } from "../use-step-hints.js";

/** The rows that the heading, the messages and the new-item input take from the list. */
const CHROME_ROWS = 6;

export interface OnboardingChecklistProps {
  heading: string;
  description: string;
  items: readonly SelectItem[];
  selected: readonly string[];
  /** Shown when `enter` is pressed with nothing checked. Leave out if an empty list is valid. */
  emptyError?: string;
  /** Lets the user add a row with `n`. */
  add?: {
    label: string;
    /** @returns The value of the new row, or an error message. */
    onAdd(text: string): { value: string } | { error: string };
  };
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
  const active = useIsActive();
  const layout = useLayout();
  const [checked, setChecked] = useState<readonly string[]>(selected);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [cursor, setCursor] = useState(0);

  useStepHints(
    onHints,
    adding
      ? [
          { key: "enter", description: "add" },
          { key: "esc", description: "cancel" },
        ]
      : [
          { key: "↑/↓", description: "select" },
          { key: "space", description: "toggle" },
          ...(add ? [{ key: "n", description: add.label.toLowerCase() }] : []),
          { key: "enter", description: "next" },
          { key: "esc", description: "back" },
        ],
  );

  const confirmAdd = () => {
    if (!add) {
      return;
    }
    const result = add.onAdd(text);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setChecked((current) => (current.includes(result.value) ? current : [...current, result.value]));
    setCursor(Math.max(0, items.length));
    setText("");
    setError(undefined);
    setAdding(false);
  };

  useInput(
    (input, key) => {
      if (adding) {
        if (key.return) {
          confirmAdd();
        } else if (key.escape) {
          setAdding(false);
          setText("");
          setError(undefined);
        }
      } else if (key.escape && !filtering) {
        onBack();
      } else if (input === "n" && add && !filtering) {
        setAdding(true);
      }
    },
    { isActive: active },
  );

  const submit = () => {
    // The order of the rows, not the order of the clicks.
    const values = items.filter((item) => checked.includes(item.value)).map((item) => item.value);
    if (emptyError && values.length === 0) {
      setError(emptyError);
    } else {
      onSubmit(values);
    }
  };

  const limit = layout.height === undefined ? items.length : Math.max(3, layout.height - CHROME_ROWS);
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
          defaultSelected={checked}
          defaultIndex={Math.min(cursor, Math.max(0, items.length - 1))}
          limit={limit}
          isActive={!adding}
          onChange={(values) => {
            setChecked(values);
            setError(undefined);
          }}
          onHighlight={(item) => {
            const at = item ? items.indexOf(item) : -1;
            if (at >= 0) {
              setCursor(at);
            }
          }}
          onFilteringChange={setFiltering}
          onSubmit={submit}
        />
      </Box>
      {add && adding && (
        <Box marginTop={1} gap={1}>
          <Text color={theme.accent}>{add.label}:</Text>
          <TextInput value={text} onChange={setText} focus={active} />
        </Box>
      )}
      {error && <Text color={theme.danger}>{error}</Text>}
    </Box>
  );
}
