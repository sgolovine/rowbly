import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { useIsActive, useKeyCapture, useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { fuzzySearch } from "../fuzzy-search.js";
import { SelectListRow } from "../select-list-row/index.js";
import { TextInput } from "../text-input/index.js";

interface SearchableSelectPickerProps {
  options: readonly string[];
  labels?: Readonly<Record<string, string>>;
  searchText?: Readonly<Record<string, readonly string[]>>;
  initialQuery: string;
  value: string | null;
  onSelect(option: string): void;
  onCancel(): void;
}

/** The results, the highlighted result and the callbacks that the keys of the picker use. */
interface PickerKeysEnv {
  readonly results: readonly string[];
  readonly selected: number;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly changeQuery: (text: string) => void;
  readonly onSelect: (option: string) => void;
  readonly onCancel: () => void;
}

/** The options that match `query`, best first. Each option matches by its value and by its search text or label. */
function searchOptions(
  options: readonly string[],
  query: string,
  labels: Readonly<Record<string, string>> | undefined,
  searchText: Readonly<Record<string, readonly string[]>> | undefined,
): string[] {
  return fuzzySearch(
    options,
    query,
    (option) => [option, ...(searchText?.[option] ?? [labels?.[option] ?? option])],
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
}

/** A new query highlights the best result. */
function changeQuery(
  setQuery: Dispatch<SetStateAction<string>>,
  setCursor: Dispatch<SetStateAction<number>>,
  text: string,
): void {
  setQuery(text);
  setCursor(0);
}

function pickerKey(env: PickerKeysEnv, input: string, key: Key): void {
  const { results, selected } = env;
  const option = results[selected];

  if (key.escape) {
    env.onCancel();

    return;
  }

  if (key.ctrl && input === "l") {
    env.changeQuery("");

    return;
  }

  if (key.downArrow) {
    env.setCursor(Math.max(0, Math.min(results.length - 1, selected + 1)));

    return;
  }

  if (key.upArrow) {
    env.setCursor(Math.max(0, selected - 1));

    return;
  }

  if (key.return && !key.ctrl && option !== undefined) {
    env.onSelect(option);
  }
}

/** A fuzzy search over the options of a select: type to search, `↑/↓` move, `enter` chooses, `esc` cancels. */
export function SearchableSelectPicker({
  options,
  labels,
  searchText,
  initialQuery,
  value,
  onSelect,
  onCancel,
}: SearchableSelectPickerProps) {
  const active = useIsActive();
  const layout = useLayout();
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(initialQuery ? 0 : Math.max(0, options.indexOf(value ?? "")));
  const results = useMemo(
    () => searchOptions(options, query, labels, searchText),
    [options, labels, searchText, query],
  );

  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  const limit = Math.max(1, Math.min(8, (layout.height ?? 14) - 5));
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), results.length - limit));
  const actions = { changeQuery: (text: string) => changeQuery(setQuery, setCursor, text) };
  const env: PickerKeysEnv = { results, selected, setCursor, changeQuery: actions.changeQuery, onSelect, onCancel };

  useKeyCapture(active, { escape: true });
  useInput((input, key) => pickerKey(env, input, key), { isActive: active });

  return (
    <Box flexDirection="column" gap={1}>
      <Box backgroundColor={theme.fieldFocus} paddingX={1}>
        <TextInput
          value={query}
          onChange={actions.changeQuery}
          focus={active}
          width={Math.max(8, layout.width - 2)}
          placeholder="Type to search…"
        />
      </Box>
      <Text color={theme.inkMuted} wrap="truncate-end">
        Selected: {!value ? "—" : (labels?.[value] ?? value)}
      </Text>
      <Box flexDirection="column">
        {results.length === 0 && (
          <Text color={theme.inkFaint}>{options.length ? "No matching choices." : "No choices available."}</Text>
        )}
        {results.slice(start, start + limit).map((option, index) => (
          <SelectListRow
            key={option}
            highlighted={start + index === selected}
            active={active}
            onClick={() => onSelect(option)}
          >
            <Text wrap="truncate-end">{labels?.[option] ?? option}</Text>
          </SelectListRow>
        ))}
      </Box>
      {results.length > limit && (
        <Text color={theme.inkFaint}>
          {selected + 1}/{results.length}
        </Text>
      )}
    </Box>
  );
}
