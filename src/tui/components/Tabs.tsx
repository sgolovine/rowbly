import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';

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

function Tab({
  label,
  selected,
  active,
  onClick,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, active);
  return (
    <Box ref={ref}>
      <Text inverse={selected} color={selected ? 'cyan' : undefined}>
        {` ${label} `}
      </Text>
    </Box>
  );
}
