import { Box } from 'ink';
import { useToasts } from '../hooks';
import { ToastLine } from './ToastLine';

export function ToastArea() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={1}>
      {toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}
