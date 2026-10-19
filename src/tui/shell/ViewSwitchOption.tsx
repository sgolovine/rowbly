import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';

/** One choice of the header's board view switch: highlighted when it is the current view, clickable otherwise. */
export function ViewSwitchOption({
  label,
  selected,
  onClick,
  clickable,
}: {
  label: string;
  selected: boolean;
  onClick(): void;
  clickable: boolean;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable && !selected);
  return (
    <Box ref={ref}>
      <Text bold={selected} color={selected ? 'cyan' : undefined} dimColor={!selected}>
        {label}
      </Text>
    </Box>
  );
}
