import { Box, type DOMElement, Text, useInput } from "ink";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIsActive, useKeyCapture, useMouse, WHEEL_LINES } from "../../hooks/index.js";
import { moveDelta } from "../../keymap.js";
import { theme } from "../../theme.js";
import { SelectListRow } from "../SelectListRow/index.js";
import { TextInput } from "../TextInput/index.js";

export interface SelectItem<T = string> {
  value: T;
  label: string;
  /** Shown right after the label, before the description, for a status with a colour of its own. */
  tag?: ReactNode;
  /** Shown dimmed after the label. */
  description?: string;
  /** Multi-select mode: `space` does not change this item. */
  locked?: boolean;
}

export interface SelectListProps<T> {
  items: readonly SelectItem<T>[];
  /** Single mode: `enter` picks the highlighted item. */
  onSelect?(item: SelectItem<T>): void;
  /** Called with the highlighted item whenever it changes, so a screen's own keys can act on it. */
  onHighlight?(item: SelectItem<T> | undefined): void;
  /** Reports whether the list is capturing filter text; false when filtering ends or it unmounts. */
  onFilteringChange?(filtering: boolean): void;
  /** Multi-select mode: `space` toggles, `enter` submits the checked values. */
  multi?: boolean;
  /** Initially checked values in multi-select mode. */
  defaultSelected?: readonly T[];
  /** The item that is highlighted first. */
  defaultIndex?: number;
  onChange?(values: T[]): void;
  onSubmit?(values: T[]): void;
  /** Shown when there are no items at all. */
  emptyText?: string;
  /** Visible rows; the list scrolls past this. */
  limit?: number;
  isActive?: boolean;
}

/**
 * A keyboard list: `↑/↓` (or `j/k`) move, `/` filters by label, `esc` clears the filter. In single mode
 * a click on an item picks it, as `enter` does.
 * A wheel notch moves the highlight by `WHEEL_LINES` while the list is longer than `limit`.
 */
export function SelectList<T>({
  items,
  onSelect,
  onHighlight,
  onFilteringChange,
  multi = false,
  defaultSelected = [],
  defaultIndex = 0,
  onChange,
  onSubmit,
  emptyText = "Nothing here yet.",
  limit = 10,
  isActive = true,
}: SelectListProps<T>) {
  const active = useIsActive() && isActive;
  const [cursor, setCursor] = useState(defaultIndex);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<readonly T[]>(defaultSelected);
  useKeyCapture(active && filtering, { escape: true });

  useEffect(() => {
    onFilteringChange?.(filtering);
  }, [filtering, onFilteringChange]);
  useEffect(() => () => onFilteringChange?.(false), [onFilteringChange]);

  const needle = filter.toLowerCase();
  const visible = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;
  const index = Math.min(cursor, Math.max(visible.length - 1, 0));

  useEffect(() => {
    if (cursor !== index) setCursor(index);
  }, [cursor, index]);

  const highlighted = visible[index];
  // biome-ignore lint/correctness/useExhaustiveDependencies: report only when the highlighted item changes.
  useEffect(() => onHighlight?.(highlighted), [highlighted]);

  const toggle = (value: T) => {
    const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    setSelected(next);
    onChange?.(next);
  };

  useInput(
    (input, key) => {
      if (filtering) {
        if (key.escape) {
          setFilter("");
          setFiltering(false);
        } else if (key.return) setFiltering(false);
        else if (key.upArrow || key.downArrow) setCursor(index + moveDelta(input, key, false));
        return;
      }
      const delta = moveDelta(input, key);
      if (delta) {
        setCursor(Math.max(0, Math.min(visible.length - 1, index + delta)));
        return;
      }
      if (input === "/") {
        setFiltering(true);
        return;
      }
      const item = visible[index];
      if (multi && input === " " && item) {
        if (!item.locked) toggle(item.value);
      }
      if (key.return) {
        if (multi) onSubmit?.([...selected]);
        else if (item) onSelect?.(item);
      }
    },
    { isActive: active },
  );

  // Only a list that scrolls takes the wheel, so a short one leaves it to an enclosing ScrollBody or modal.
  const listRef = useRef<DOMElement>(null);
  useMouse(
    listRef,
    {
      onWheel: (direction) =>
        setCursor((current) =>
          Math.max(0, Math.min(visible.length - 1, Math.min(current, visible.length - 1) + direction * WHEEL_LINES)),
        ),
    },
    active && visible.length > limit,
  );

  const start = Math.max(0, Math.min(index - Math.floor(limit / 2), visible.length - limit));
  const rows = visible.slice(start, start + limit);

  return (
    <Box flexDirection="column">
      {(filtering || filter) && (
        <Box>
          <Text color={theme.accent}>/</Text>
          <TextInput value={filter} onChange={setFilter} focus={active && filtering} />
        </Box>
      )}
      {visible.length === 0 && (
        <Text color={theme.inkFaint}>{items.length === 0 ? emptyText : `No matches for "${filter}".`}</Text>
      )}
      <Box ref={listRef} flexDirection="column">
        {rows.map((item, i) => {
          const highlighted = start + i === index;
          const checkbox = multi ? (selected.includes(item.value) ? "[x] " : "[ ] ") : "";
          // In single mode a click picks the item, as `enter` on it does.
          const pick =
            !multi && onSelect
              ? () => {
                  setCursor(start + i);
                  onSelect(item);
                }
              : undefined;
          return (
            <SelectListRow key={String(item.value)} highlighted={highlighted} active={active} onClick={pick}>
              {checkbox}
              {item.label}
              {item.tag}
              {item.description && <Text color={theme.inkFaint}> {item.description}</Text>}
            </SelectListRow>
          );
        })}
      </Box>
      {visible.length > rows.length && <Text color={theme.inkFaint}>{`  ${index + 1}/${visible.length}`}</Text>}
    </Box>
  );
}
