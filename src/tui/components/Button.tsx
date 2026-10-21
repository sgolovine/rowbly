import { Box, type DOMElement, Text } from 'ink';
import { useRef, useState } from 'react';
import { useMouse } from '../hooks';
import { theme } from '../theme';

export interface ButtonProps {
  label: string;
  /** The key that does the same, shown dim beside the label. */
  keyName?: string;
  onClick(): void;
  clickable: boolean;
  /** Sized to its label, for tight spots like the header; otherwise as wide as its parent. */
  compact?: boolean;
  primary?: boolean;
}

export function Button({ label, keyName, onClick, clickable, compact = false, primary = false }: ButtonProps) {
  const ref = useRef<DOMElement>(null);
  const [hovered, setHovered] = useState(false);
  useMouse(ref, { onClick, onEnter: () => setHovered(true), onLeave: () => setHovered(false) }, clickable);
  return (
    <Box
      ref={ref}
      backgroundColor={hovered && clickable ? theme.selection : undefined}
      width={compact ? undefined : '100%'}
      flexShrink={0}
      justifyContent="center"
      gap={1}
      paddingX={1}
    >
      <Text bold={primary} color={primary ? theme.accent : theme.ink}>
        {label}
      </Text>
      {keyName && (
        <Text backgroundColor={theme.keycap} color={primary ? theme.accent : theme.inkMuted}>
          {' '}
          {keyName}{' '}
        </Text>
      )}
    </Box>
  );
}
