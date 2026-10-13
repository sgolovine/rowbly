import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import { useMouse } from '../hooks';

export interface ButtonProps {
  label: string;
  /** The key that does the same, shown dim beside the label. */
  keyName?: string;
  onClick(): void;
  clickable: boolean;
  /** Sized to its label, for tight spots like the header; otherwise as wide as its parent. */
  compact?: boolean;
}

export function Button({ label, keyName, onClick, clickable, compact = false }: ButtonProps) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick }, clickable);
  return (
    <Box
      ref={ref}
      width={compact ? undefined : '100%'}
      flexShrink={0}
      justifyContent="center"
      gap={1}
      borderStyle="round"
      borderColor="cyan"
    >
      <Text bold color="cyan">
        {label}
      </Text>
      {keyName && <Text dimColor>{keyName}</Text>}
    </Box>
  );
}
