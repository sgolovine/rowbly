import { Text } from 'ink';
import { useEffect } from 'react';
import { type Toast, useToast } from '../hooks';

const TOAST_COLORS = { info: 'cyan', warning: 'yellow', error: 'red' } as const;
const TOAST_MS = { info: 4000, warning: 6000, error: 8000 } as const;

export function ToastLine({ toast }: { toast: Toast }) {
  const store = useToast();
  useEffect(() => {
    const timer = setTimeout(() => store.dismiss(toast.id), TOAST_MS[toast.kind]);
    return () => clearTimeout(timer);
  }, [store, toast]);
  return (
    <Text color={TOAST_COLORS[toast.kind]}>
      {toast.kind === 'info' ? '' : `${toast.kind}: `}
      {toast.message}
    </Text>
  );
}
