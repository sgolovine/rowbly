import { Box, Text, useInput } from 'ink';
import { useContext, useEffect, useState } from 'react';
import { useIsActive, useKeyCapture } from '../hooks';
import { theme } from '../theme';
import { FormKeysContext } from './modalLayer';

const NO_KEYS: readonly [] = [];

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
  // In a Modal, `esc` reads `cancel`, as it does around a Form.
  const modal = useContext(FormKeysContext);
  useEffect(() => (active && modal ? modal(NO_KEYS) : undefined), [active, modal]);

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

  const color = destructive ? theme.danger : theme.stageBoard;
  return (
    <Box flexDirection="column" alignSelf="flex-start">
      <Text>{message}</Text>
      <Box marginTop={1} gap={2}>
        <Text bold={confirmFocused} color={color} backgroundColor={confirmFocused ? theme.selection : undefined}>
          {` ${confirmLabel} (y) `}
        </Text>
        <Text
          bold={!confirmFocused}
          color={theme.ink}
          backgroundColor={!confirmFocused ? theme.selection : undefined}
        >{` ${cancelLabel} (n) `}</Text>
      </Box>
    </Box>
  );
}
