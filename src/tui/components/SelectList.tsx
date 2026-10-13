import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { useIsActive, useKeyCapture } from '../hooks';
import { moveDelta } from '../keymap';
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

/** A keyboard list: `↑/↓`/`j/k` move, `/` filters by label, `esc` clears the filter. */
export function SelectList<T>({
  items,
  onSelect,
  onHighlight,
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
          <Text color="cyan">/</Text>
          <TextInput value={filter} onChange={setFilter} focus={active && filtering} />
        </Box>
      )}
      {visible.length === 0 && <Text dimColor>{items.length === 0 ? emptyText : `No matches for "${filter}".`}</Text>}
      {rows.map((item, i) => {
        const highlighted = start + i === index;
        const checkbox = multi ? (selected.includes(item.value) ? '[x] ' : '[ ] ') : '';
        return (
          <Text key={String(item.value)} color={highlighted && active ? 'cyan' : undefined}>
            {highlighted ? '› ' : '  '}
            {checkbox}
            {item.label}
            {item.description && <Text dimColor> {item.description}</Text>}
          </Text>
        );
      })}
      {visible.length > rows.length && <Text dimColor>{`  ${index + 1}/${visible.length}`}</Text>}
    </Box>
  );
}
