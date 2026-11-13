import { Box } from "ink";
import { useToasts } from "../../hooks/index.js";
import { ToastLine } from "../toast-line/index.js";

export function ToastArea() {
  const toasts = useToasts();
  if (toasts.length === 0) {
    return null;
  }
  return (
    <Box position="absolute" bottom={1} right={1} flexDirection="column" alignItems="flex-end" maxWidth={80}>
      {toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}
