import { Box, Text } from 'ink';
import { useEffect } from 'react';
import { Spinner } from '../components';
import { type Toast, useToast } from '../hooks';
import { theme } from '../theme';

const TOAST_COLORS = { info: theme.accent, warning: theme.stageBoard, error: theme.danger } as const;
const TOAST_MS = { info: 4000, warning: 6000, error: 8000 } as const;

export function ToastLine({ toast }: { toast: Toast }) {
  const store = useToast();
  useEffect(() => {
    if (toast.pending) return;
    const timer = setTimeout(() => store.dismiss(toast.id), TOAST_MS[toast.kind]);
    return () => clearTimeout(timer);
  }, [store, toast]);
  const glyph = toast.kind === 'info' ? '✓' : toast.kind === 'warning' ? '!' : '✕';
  // No frame: every row is a full-width string on the `overlay-raised` fill, so the fill has no gaps.
  const blank = ' '.repeat(toast.message.length + 6);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text backgroundColor={theme.overlayRaised}>{blank}</Text>
      <Text backgroundColor={theme.overlayRaised}>
        <Text color={TOAST_COLORS[toast.kind]}>
          {'  '}
          {toast.pending ? <Spinner /> : glyph}{' '}
        </Text>
        <Text color={theme.ink}>{`${toast.message}  `}</Text>
      </Text>
      <Text backgroundColor={theme.overlayRaised}>{blank}</Text>
    </Box>
  );
}
