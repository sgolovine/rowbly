import { Text } from "ink";
import { useMemo } from "react";
import { useLayout } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { FuzzyPicker } from "../fuzzy-picker/index.js";

interface SearchableSelectPickerProps {
  options: readonly string[];
  labels?: Readonly<Record<string, string>>;
  searchText?: Readonly<Record<string, readonly string[]>>;
  initialQuery: string;
  value: string | null;
  /** The picker adds an option to a list, so it does not show the `Selected:` line. */
  hideSelected?: boolean;
  onSelect(option: string): void;
  onCancel(): void;
}

/** The search of an option: its value and its search text or label. */
function optionSearch(
  labels: Readonly<Record<string, string>> | undefined,
  searchText: Readonly<Record<string, readonly string[]>> | undefined,
): (option: string) => readonly string[] {
  return (option) => [option, ...(searchText?.[option] ?? [labels?.[option] ?? option])];
}

function compareOptions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/** A fuzzy search over the options of a select: type to search, `↑/↓` move, `enter` chooses, `esc` cancels. */
export function SearchableSelectPicker({
  options,
  labels,
  searchText,
  initialQuery,
  value,
  hideSelected = false,
  onSelect,
  onCancel,
}: SearchableSelectPickerProps) {
  const layout = useLayout();
  const search = useMemo(() => optionSearch(labels, searchText), [labels, searchText]);

  return (
    <FuzzyPicker
      items={options}
      search={search}
      compare={compareOptions}
      itemKey={(option) => option}
      renderItem={(option) => <Text wrap="truncate-end">{labels?.[option] ?? option}</Text>}
      emptyText={options.length ? "No matching choices." : "No choices available."}
      limit={Math.max(1, Math.min(8, (layout.height ?? 14) - 5))}
      placeholder="Type to search…"
      inputWidth={layout.width - 2}
      header={() =>
        !hideSelected && (
          <Text color={theme.inkMuted} wrap="truncate-end">
            Selected: {!value ? "—" : (labels?.[value] ?? value)}
          </Text>
        )
      }
      counter={true}
      initialQuery={initialQuery}
      initialCursor={initialQuery ? 0 : Math.max(0, options.indexOf(value ?? ""))}
      clearKey={true}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
