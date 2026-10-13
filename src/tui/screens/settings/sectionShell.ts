import type { ShellRegistry } from '../../hooks';
import type { KeyHint } from '../../keymap';

/**
 * The shell registry as the section beside the settings sidebar sees it: everything goes to the real
 * one except its key hints, which go to `onHints` so the settings screen can show them with its own.
 */
export function sectionShell(shell: ShellRegistry, onHints: (hints: readonly KeyHint[]) => void): ShellRegistry {
  return {
    ...shell,
    setHints: (_depth, hints) => onHints(hints ?? []),
  };
}
