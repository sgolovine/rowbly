import { Store } from "../../services/store/store.js";
import type { KeyHint } from "../keymap.js";
import { createShellRegistry, type ShellRegistry } from "./shell.js";

/** The shell registry as a settings section sees it, and whether the section holds `esc` itself. */
export interface SectionShell extends ShellRegistry {
  /** True while the section captures `esc`, e.g. for an open form, so `esc` is the section's alone. */
  holdsEscape(): boolean;
}

type EscapeCount = Store<{ escapes: number }>;

function captureSection(
  shell: ShellRegistry,
  section: EscapeCount,
  keys: Parameters<ShellRegistry["capture"]>[0],
): () => void {
  const release = shell.capture(keys);

  if (!keys.escape) {
    return release;
  }

  const capture = new Store({ released: false });

  section.update((state) => ({ escapes: state.escapes + 1 }));

  return () => releaseSection(section, capture, release);
}

/** Releases a capture of `esc` one time, also when the caller releases it again. */
function releaseSection(section: EscapeCount, capture: Store<{ released: boolean }>, release: () => void): void {
  if (capture.current.released) {
    return;
  }

  capture.update(() => ({ released: true }));
  section.update((state) => ({ escapes: state.escapes - 1 }));
  release();
}

function showSectionHints(
  hints: ShellRegistry,
  onHints: (hints: readonly KeyHint[]) => void,
  id: string,
  next: readonly KeyHint[] | null,
  lead: boolean | undefined,
): void {
  hints.setHints(0, id, next, lead);
  onHints(hints.hints(0));
}

/**
 * The shell registry as a screen embedded in another sees it (a settings section, an onboarding step):
 * everything goes to the real one except its key hints, which go to `onHints` so the embedding screen
 * can show them with its own.
 */
export function sectionShell(shell: ShellRegistry, onHints: (hints: readonly KeyHint[]) => void): SectionShell {
  const section = new Store({ escapes: 0 });
  // Collects the parts of the section's hints, as the shell does for a screen.
  const hints = createShellRegistry();

  return {
    ...shell,
    capture: (keys) => captureSection(shell, section, keys),
    holdsEscape: () => section.current.escapes > 0,
    setHints: (_depth, id, next, lead) => showSectionHints(hints, onHints, id, next, lead),
  };
}
