import { Box, type DOMElement, type Key, Text, useInput } from "ink";
import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useRef, useState } from "react";
import { useIsActive, useKeyCapture, useMouse, WHEEL_LINES } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { fuzzySearch } from "../fuzzy-search.js";
import { SelectListRow } from "../select-list-row/index.js";
import { TextInput } from "../text-input/index.js";

/** The state that the header and the footer of a picker show. */
export interface FuzzyPickerView {
  readonly count: number;
  readonly selected: number;
  readonly limit: number;
}

interface FuzzyPickerProps<T> {
  // The items, how the search finds and sorts them, and their rows.
  readonly items: readonly T[];
  readonly search: (item: T) => readonly string[];
  readonly compare: (a: T, b: T) => number;
  readonly itemKey: (item: T) => string;
  readonly renderItem: (item: T) => ReactNode;
  readonly emptyText: string;
  /** The number of result rows on screen. */
  readonly limit: number;

  // The input and the other parts of the layout.
  readonly placeholder: string;
  readonly inputWidth: number;
  readonly width?: number;
  readonly prefix?: ReactNode;
  readonly header?: (view: FuzzyPickerView) => ReactNode;
  /** The `i/N` counter below the list, when the list is longer than `limit`. */
  readonly counter?: boolean;

  // The start state and the options.
  readonly initialQuery?: string;
  readonly initialCursor?: number;
  /** The wheel scrolls the results when they are longer than `limit`. */
  readonly wheel?: boolean;
  /** `ctrl+l` clears the query. */
  readonly clearKey?: boolean;

  onSelect(item: T): void;
  onCancel(): void;
}

/** The results, the highlighted result and the callbacks that the keys and the mouse of the picker use. */
type PickerEnv<T> = Pick<FuzzyPickerProps<T>, "clearKey" | "onSelect" | "onCancel"> & {
  readonly results: readonly T[];
  readonly selected: number;
  readonly setQuery: Dispatch<SetStateAction<string>>;
  readonly setCursor: Dispatch<SetStateAction<number>>;
};

/** The first result row on screen, so that the selected row stays near the middle. */
function firstRow(selected: number, limit: number, count: number): number {
  return Math.max(0, Math.min(selected - Math.floor(limit / 2), count - limit));
}

function move<T>(env: PickerEnv<T>, delta: number): void {
  env.setCursor(Math.max(0, Math.min(env.results.length - 1, env.selected + delta)));
}

/** A new query highlights the best result. */
function changeQuery<T>(env: PickerEnv<T>, text: string): void {
  env.setQuery(text);
  env.setCursor(0);
}

function pickerKey<T>(env: PickerEnv<T>, input: string, key: Key): void {
  const item = env.results[env.selected];

  if (key.escape) {
    env.onCancel();
  } else if (env.clearKey && key.ctrl && input === "l") {
    changeQuery(env, "");
  } else if (key.downArrow) {
    move(env, 1);
  } else if (key.upArrow) {
    move(env, -1);
  } else if (key.return && !key.ctrl && item !== undefined) {
    env.onSelect(item);
  }
}

/**
 * A fuzzy search over a list of items: type to search, `↑/↓` move, `enter` chooses, `esc` cancels.
 * The caller gives the search text, the order, the rows and the header line.
 */
export function FuzzyPicker<T>(props: FuzzyPickerProps<T>) {
  const { items, search, compare, itemKey, renderItem, limit, onSelect } = props;
  const active = useIsActive();
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [cursor, setCursor] = useState(props.initialCursor ?? 0);
  const list = useRef<DOMElement>(null);
  const results = useMemo(() => fuzzySearch(items, query, search, compare), [items, query, search, compare]);

  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  const start = firstRow(selected, limit, results.length);
  const wheel = active && props.wheel === true && results.length > limit;
  const env: PickerEnv<T> = { ...props, results, selected, setQuery, setCursor };

  useMouse(list, { onWheel: (direction) => move(env, direction * WHEEL_LINES) }, wheel);
  useKeyCapture(active, { escape: true });
  useInput((input, key) => pickerKey(env, input, key), { isActive: active });

  return (
    <Box flexDirection="column" gap={1} width={props.width}>
      <Box backgroundColor={theme.fieldFocus} paddingX={1}>
        {props.prefix}
        <TextInput
          value={query}
          onChange={(text) => changeQuery(env, text)}
          focus={active}
          width={Math.max(8, props.inputWidth)}
          placeholder={props.placeholder}
        />
      </Box>
      {props.header?.({ count: results.length, selected, limit })}
      <Box ref={list} flexDirection="column">
        {results.length === 0 && <Text color={theme.inkFaint}>{props.emptyText}</Text>}
        {results.slice(start, start + limit).map((item, index) => (
          <SelectListRow
            key={itemKey(item)}
            highlighted={start + index === selected}
            active={active}
            onClick={() => onSelect(item)}
          >
            {renderItem(item)}
          </SelectListRow>
        ))}
      </Box>
      {props.counter && results.length > limit && (
        <Text color={theme.inkFaint}>
          {selected + 1}/{results.length}
        </Text>
      )}
    </Box>
  );
}
