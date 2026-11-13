import { Box, Text } from "ink";
import { theme } from "../../theme.js";
import { SelectListRow } from "../select-list-row/index.js";
import { TextInput } from "../text-input/index.js";
import type { SelectListProps } from "./select-list-types.js";
import { pickItem, useSelectList } from "./use-select-list.js";

export type { SelectItem, SelectListProps } from "./select-list-types.js";

function checkbox<T>(multi: boolean, selected: readonly T[], value: T): string {
  if (!multi) {
    return "";
  }

  return selected.includes(value) ? "[x] " : "[ ] ";
}

/** The first visible row: the highlight stays in the middle of the rows where it can. */
function firstRow(index: number, limit: number, count: number): number {
  return Math.max(0, Math.min(index - Math.floor(limit / 2), count - limit));
}

/**
 * A keyboard list: `↑/↓` (or `j/k`) move, `/` filters by label, `esc` clears the filter. In single mode
 * a click on an item picks it, as `enter` does.
 * A wheel notch moves the highlight by `WHEEL_LINES` while the list is longer than `limit`.
 */
export function SelectList<T>(props: SelectListProps<T>) {
  const { env, active, filter, listRef } = useSelectList(props);

  const { items, onSelect, multi = false, emptyText = "Nothing here yet.", limit = 10 } = props;
  const { visible, index, filtering, selected } = env;
  const start = firstRow(index, limit, visible.length);
  const rows = visible.slice(start, start + limit);

  return (
    <Box flexDirection="column">
      {(filtering || filter) && (
        <Box>
          <Text color={theme.accent}>/</Text>
          <TextInput value={filter} onChange={env.setFilter} focus={active && filtering} />
        </Box>
      )}
      {visible.length === 0 && (
        <Text color={theme.inkFaint}>{items.length === 0 ? emptyText : `No matches for "${filter}".`}</Text>
      )}
      <Box ref={listRef} flexDirection="column">
        {rows.map((item, i) => (
          <SelectListRow
            key={String(item.value)}
            highlighted={start + i === index}
            active={active}
            // In single mode a click picks the item, as `enter` on it does.
            onClick={!multi && onSelect ? () => pickItem(env, start + i, item) : undefined}
          >
            {checkbox(multi, selected, item.value)}
            {item.label}
            {item.tag}
            {item.description && <Text color={theme.inkFaint}> {item.description}</Text>}
          </SelectListRow>
        ))}
      </Box>
      {visible.length > rows.length && <Text color={theme.inkFaint}>{`  ${index + 1}/${visible.length}`}</Text>}
    </Box>
  );
}
