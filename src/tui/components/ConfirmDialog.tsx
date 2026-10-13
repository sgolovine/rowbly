import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useIsActive, useKeyCapture } from '../hooks';

export interface ConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colours the dialog red; use for deletions. */
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
  isActive?: boolean;
}

/** Asks before a destructive action. `y` confirms, `n`/`esc` cancel; `enter` picks the focused button (cancel by default). */
export function ConfirmDialog({
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  destructive = false,
  onConfirm,
  onCancel,
  isActive = true,
}: ConfirmDialogProps) {
  const active = useIsActive() && isActive;
  const [confirmFocused, setConfirmFocused] = useState(false);
  useKeyCapture(active, { escape: true });

  useInput(
    (input, key) => {
      if (input === 'y') onConfirm();
      else if (input === 'n' || key.escape) onCancel();
      else if (key.leftArrow || key.rightArrow || key.tab || input === 'h' || input === 'l')
        setConfirmFocused((f) => !f);
      else if (key.return) (confirmFocused ? onConfirm : onCancel)();
    },
    { isActive: active },
  );

  const color = destructive ? 'red' : 'yellow';
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} alignSelf="flex-start">
      <Text>{message}</Text>
      <Box marginTop={1} gap={2}>
        <Text inverse={confirmFocused} color={confirmFocused ? color : undefined}>
          {` ${confirmLabel} (y) `}
        </Text>
        <Text inverse={!confirmFocused}>{` ${cancelLabel} (n) `}</Text>
      </Box>
    </Box>
  );
}
