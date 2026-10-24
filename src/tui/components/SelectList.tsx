import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { useIsActive, useKeyCapture } from '../hooks';
import { moveDelta } from '../keymap';
import { theme } from '../theme';
import { SelectListRow } from './SelectListRow';
import { TextInput } from './TextInput';

export interface SelectItem<T = string> {
  value: T;
  label: string;
  /** Shown dimmed after the label. */
  description?: string;
}

export interface SelectListProps<T> {
  items: readonly SelectItem<T>[];
  /** Single mode: `enter` picks the highlighted item. */
  onSelect?(item: SelectItem<T>): void;
  /** Called with the highlighted item whenever it changes, so a screen's own keys can act on it. */
  onHighlight?(item: SelectItem<T> | undefined): void;
  /**
   * A right click on an item, at cell `x`, `y`: the item is highlighted first, so open a context menu
   * there of what the screen's keys do to it (`useContextMenu`).
   */
  onContextMenu?(item: SelectItem<T>, x: number, y: number): void;
  /** Reports whether the list is capturing filter text; false when filtering ends or it unmounts. */
  onFilteringChange?(filtering: boolean): void;
  /** Multi-select mode: `space` toggles, `enter` submits the checked values. */
  multi?: boolean;
  /** Initially checked values in multi-select mode. */
  defaultSelected?: readonly T[];
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
 * a click on an item picks it, as `enter` does. A right click highlights the item and calls `onContextMenu`.
 */
export function SelectList<T>({
  items,
  onSelect,
  onHighlight,
  onContextMenu,
  onFilteringChange,
  multi = false,
  defaultSelected = [],
  onChange,
  onSubmit,
  emptyText = 'Nothing here yet.',
  limit = 10,
  isActive = true,
}: SelectListProps<T>) {
  const active = useIsActive() && isActive;
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState('');
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
          setFilter('');
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
      if (input === '/') {
        setFiltering(true);
        return;
      }
      const item = visible[index];
      if (multi && input === ' ' && item) toggle(item.value);
      else if (key.return) {
        if (multi) onSubmit?.([...selected]);
        else if (item) onSelect?.(item);
      }
    },
    { isActive: active },
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
      {rows.map((item, i) => {
        const highlighted = start + i === index;
        const checkbox = multi ? (selected.includes(item.value) ? '[x] ' : '[ ] ') : '';
        // In single mode a click picks the item, as `enter` on it does.
        const pick =
          !multi && onSelect
            ? () => {
                setCursor(start + i);
                onSelect(item);
              }
            : undefined;
        const menu = onContextMenu
          ? (x: number, y: number) => {
              setCursor(start + i);
              onContextMenu(item, x, y);
            }
          : undefined;
        return (
          <SelectListRow
            key={String(item.value)}
            highlighted={highlighted}
            active={active}
            onClick={pick}
            onContextMenu={menu}
          >
            {checkbox}
            {item.label}
            {item.description && <Text color={theme.inkFaint}> {item.description}</Text>}
          </SelectListRow>
        );
      })}
      {visible.length > rows.length && <Text color={theme.inkFaint}>{`  ${index + 1}/${visible.length}`}</Text>}
    </Box>
  );
}
