import { Box } from 'ink';
import { useToasts } from '../hooks';
import { ToastLine } from './ToastLine';

export function ToastArea() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <Box position="absolute" bottom={1} right={1} flexDirection="column" alignItems="flex-end" maxWidth={80}>
      {toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}
