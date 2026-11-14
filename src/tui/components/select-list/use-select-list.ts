import { type DOMElement, type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { useIsActive, useKeyCapture, useMouse } from "../../hooks/index.js";
import { moveDelta } from "../../keymap.js";
import { clampOffset, wheelOffset } from "../scroll-offset.js";
import type { SelectItem, SelectListProps } from "./select-list-types.js";

/** The state, the props and the setters that the keys and the clicks of a `SelectList` use. */
export interface SelectListEnv<T> {
  readonly visible: readonly SelectItem<T>[];
  readonly index: number;
  readonly filtering: boolean;
  readonly selected: readonly T[];
  readonly multi: boolean;
  /** A click on an item that is not highlighted only highlights it. */
  readonly clickToHighlight: boolean;
  readonly onSelect?: (item: SelectItem<T>) => void;
  readonly onChange?: (values: T[]) => void;
  readonly onSubmit?: (values: T[]) => void;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly setFilter: Dispatch<SetStateAction<string>>;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
  readonly setSelected: Dispatch<SetStateAction<readonly T[]>>;
}

function visibleItems<T>(items: readonly SelectItem<T>[], filter: string): readonly SelectItem<T>[] {
  const needle = filter.toLowerCase();

  return needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
}

function toggleValue<T>(env: SelectListEnv<T>, value: T): void {
  const { selected } = env;
  const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];

  env.setSelected(next);
  env.onChange?.(next);
}

/** The keys while the filter takes the text: `esc` clears it, `enter` keeps it, and `↑/↓` still move. */
function filterKey<T>(env: SelectListEnv<T>, input: string, key: Key): void {
  if (key.escape) {
    env.setFilter("");
    env.setFiltering(false);

    return;
  }

  if (key.return) {
    env.setFiltering(false);

    return;
  }

  if (key.upArrow || key.downArrow) {
    env.setCursor(env.index + moveDelta(input, key, false));
  }
}

/** `space` toggles the highlighted item in multi mode; `enter` submits the checked values or picks the item. */
function pickKey<T>(env: SelectListEnv<T>, input: string, key: Key): void {
  const item = env.visible[env.index];

  if (env.multi && input === " " && item && !item.locked) {
    toggleValue(env, item.value);
  }

  if (key.return && env.multi) {
    env.onSubmit?.([...env.selected]);

    return;
  }

  if (key.return && item) {
    env.onSelect?.(item);
  }
}

function handleListKey<T>(env: SelectListEnv<T>, input: string, key: Key): void {
  const delta = moveDelta(input, key);

  if (env.filtering) {
    filterKey(env, input, key);

    return;
  }

  if (delta) {
    env.setCursor(clampOffset(env.index + delta, env.visible.length - 1));

    return;
  }

  if (input === "/") {
    env.setFiltering(true);

    return;
  }

  pickKey(env, input, key);
}

/**
 * Picks the item at `at` after a click, as `enter` on it does. With `clickToHighlight`, a click on an
 * item that is not highlighted only highlights it.
 */
export function pickItem<T>(env: SelectListEnv<T>, at: number, item: SelectItem<T>): void {
  env.setCursor(at);

  if (env.clickToHighlight && at !== env.index) {
    return;
  }

  env.onSelect?.(item);
}

/** The filter, the highlight, the checked values and the keys of a `SelectList`. */
export function useSelectList<T>({
  items,
  onSelect,
  clickToHighlight = false,
  onHighlight,
  onFilteringChange,
  multi = false,
  defaultSelected = [],
  defaultIndex = 0,
  onChange,
  onSubmit,
  limit = 10,
  isActive = true,
}: SelectListProps<T>) {
  const active = useIsActive() && isActive;
  const [cursor, setCursor] = useState(defaultIndex);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<readonly T[]>(defaultSelected);
  // Only a list that scrolls takes the wheel, so a short one leaves it to an enclosing ScrollBody or modal.
  const listRef = useRef<DOMElement>(null);

  const visible = visibleItems(items, filter);
  const index = Math.min(cursor, Math.max(visible.length - 1, 0));
  const highlighted = visible[index];
  const env: SelectListEnv<T> = {
    visible,
    index,
    filtering,
    selected,
    multi,
    clickToHighlight,
    onSelect,
    onChange,
    onSubmit,
    setCursor,
    setFilter,
    setFiltering,
    setSelected,
  };

  useKeyCapture(active && filtering, { escape: true });
  useEffect(() => {
    onFilteringChange?.(filtering);
  }, [filtering, onFilteringChange]);
  useEffect(() => () => onFilteringChange?.(false), [onFilteringChange]);
  useEffect(() => {
    if (cursor !== index) {
      setCursor(index);
    }
  }, [cursor, index]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the highlighted item changes.
  useEffect(() => {
    onHighlight?.(highlighted);
  }, [highlighted]);
  useInput((input, key) => handleListKey(env, input, key), { isActive: active });
  useMouse(
    listRef,
    { onWheel: (direction) => setCursor((current) => wheelOffset(current, visible.length - 1, direction)) },
    active && visible.length > limit,
  );

  return { env, active, filter, listRef };
}
