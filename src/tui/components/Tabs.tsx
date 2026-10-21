import { Box } from 'ink';
import { Tab } from './Tab';

/** A row of tab labels; the `selected` one is highlighted. Clicking a tab selects it while `active`. */
export function Tabs({
  tabs,
  selected,
  onSelect,
  active,
}: {
  tabs: readonly string[];
  selected: number;
  onSelect(index: number): void;
  active: boolean;
}) {
  return (
    <Box gap={1}>
      {tabs.map((name, i) => (
        <Tab key={name} label={name} selected={i === selected} active={active} onClick={() => onSelect(i)} />
      ))}
    </Box>
  );
}
