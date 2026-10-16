import { useInput } from 'ink';

/** Cancels the open form or dialog on `esc` instead of leaving the screen. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useInput(
    (_input, key) => {
      if (key.escape) onEscape();
    },
    { isActive: active },
  );
}
