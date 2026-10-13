import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';

export function HeaderButton({ label, onClick, clickable }: { label: string; onClick(): void; clickable: boolean }) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box ref={ref}>
      <Text inverse color="cyan">{` ${label} `}</Text>
    </Box>
  );
}
