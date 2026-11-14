import { Box } from "ink";
import { Tab } from "../tab/index.js";

/** A row of tab labels; the `selected` one is highlighted. Clicking a tab selects it while `active`. A narrow row wraps between tabs, not in a label. */
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
    <Box columnGap={1} flexWrap="wrap">
      {tabs.map((name, i) => (
        <Tab key={name} label={name} selected={i === selected} active={active} onClick={() => onSelect(i)} />
      ))}
    </Box>
  );
}
