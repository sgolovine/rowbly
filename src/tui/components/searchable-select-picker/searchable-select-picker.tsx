import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { useIsActive, useKeyCapture, useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { fuzzySearch } from "../fuzzy-search.js";
import { SelectListRow } from "../select-list-row/index.js";
import { TextInput } from "../text-input/index.js";

export function SearchableSelectPicker({
  options,
  labels,
  searchText,
  initialQuery,
  value,
  onSelect,
  onCancel,
}: {
  options: readonly string[];
  labels?: Readonly<Record<string, string>>;
  searchText?: Readonly<Record<string, readonly string[]>>;
  initialQuery: string;
  value: string | null;
  onSelect(option: string): void;
  onCancel(): void;
}) {
  const active = useIsActive();
  const layout = useLayout();
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(initialQuery ? 0 : Math.max(0, options.indexOf(value ?? "")));
  const results = useMemo(
    () =>
      fuzzySearch(
        options,
        query,
        (option) => [option, ...(searchText?.[option] ?? [labels?.[option] ?? option])],
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      ),
    [options, labels, searchText, query],
  );
  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  const limit = Math.max(1, Math.min(8, (layout.height ?? 14) - 5));
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), results.length - limit));
  useKeyCapture(active, { escape: true });
  const changeQuery = (text: string) => {
    setQuery(text);
    setCursor(0);
  };
  useInput(
    (input, key) => {
      if (key.escape) onCancel();
      else if (key.ctrl && input === "l") changeQuery("");
      else if (key.downArrow) setCursor(Math.max(0, Math.min(results.length - 1, selected + 1)));
      else if (key.upArrow) setCursor(Math.max(0, selected - 1));
      else if (key.return && !key.ctrl && results[selected] !== undefined) onSelect(results[selected]);
    },
    { isActive: active },
  );
  return (
    <Box flexDirection="column" gap={1}>
      <Box backgroundColor={theme.fieldFocus} paddingX={1}>
        <TextInput
          value={query}
          onChange={changeQuery}
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
