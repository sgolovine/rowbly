/**
 * Calls `unsubscribe` when `signal` aborts, or at once when it has aborted already. A watch that starts
 * after its effect was cleaned up then stops as soon as it starts.
 */
export function stopOnAbort(signal: AbortSignal, unsubscribe: () => void): void {
  if (signal.aborted) {
    unsubscribe();

    return;
  }

  signal.addEventListener("abort", unsubscribe, { once: true });
}
