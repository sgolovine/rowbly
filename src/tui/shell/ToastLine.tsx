import { Box, Text } from 'ink';
import { useEffect } from 'react';
import { type Toast, useToast } from '../hooks';
import { theme } from '../theme';

const TOAST_COLORS = { info: theme.accent, warning: theme.stageBoard, error: theme.danger } as const;
const TOAST_MS = { info: 4000, warning: 6000, error: 8000 } as const;

export function ToastLine({ toast }: { toast: Toast }) {
  const store = useToast();
  useEffect(() => {
    const timer = setTimeout(() => store.dismiss(toast.id), TOAST_MS[toast.kind]);
    return () => clearTimeout(timer);
  }, [store, toast]);
  return (
    <Box borderStyle="round" borderColor={theme.border} backgroundColor={theme.overlay} paddingX={1}>
      <Text color={TOAST_COLORS[toast.kind]}>
        {toast.kind === 'info' ? '✓ ' : toast.kind === 'warning' ? '! ' : '✕ '}
        {toast.message}
      </Text>
    </Box>
  );
}
