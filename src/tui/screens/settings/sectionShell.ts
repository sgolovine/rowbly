import { createShellRegistry, type ShellRegistry } from '../../hooks';
import type { KeyHint } from '../../keymap';

/** The shell registry as a settings section sees it, and whether the section holds `esc` itself. */
export interface SectionShell extends ShellRegistry {
  /** True while the section captures `esc`, e.g. for an open form, so `esc` is the section's alone. */
  holdsEscape(): boolean;
}

/**
 * The shell registry as the section beside the settings sidebar sees it: everything goes to the real
 * one except its key hints, which go to `onHints` so the settings screen can show them with its own.
 */
export function sectionShell(shell: ShellRegistry, onHints: (hints: readonly KeyHint[]) => void): SectionShell {
  let escapes = 0;
  // Collects the parts of the section's hints, as the shell does for a screen.
  const hints = createShellRegistry();
  return {
    ...shell,
    capture(withEscape) {
      const release = shell.capture(withEscape);
      if (!withEscape) return release;
      escapes += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        escapes -= 1;
        release();
      };
    },
    holdsEscape: () => escapes > 0,
    setHints(_depth, id, next, lead) {
      hints.setHints(0, id, next, lead);
      onHints(hints.hints(0));
    },
  };
}
