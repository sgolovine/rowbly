/** Clipboard toasts and Attachment rows use the same rounded size. */
export function formatSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
