import { Text } from "ink";
import { theme } from "../../theme.js";

/** The progress of the last save of a `FullScreenEditor`. */
export type SaveState =
  | { readonly kind: "idle" | "saving" | "saved" }
  | { readonly kind: "failed"; readonly message: string };

export interface SaveStatusProps {
  readonly save: SaveState;
  /** The text has changes that are not saved. */
  readonly dirty: boolean;
}

/** Whether the text is saved, shown after the mode; nothing until there is something to save. */
export function SaveStatus({ save, dirty }: SaveStatusProps) {
  if (save.kind === "saving") {
    return <Text color={theme.inkFaint}>saving…</Text>;
  }

  if (save.kind === "failed") {
    return <Text color={theme.danger} wrap="truncate-end">{`not saved: ${save.message}`}</Text>;
  }

  if (dirty) {
    return <Text color={theme.stageBoard}>unsaved</Text>;
  }

  if (save.kind === "saved") {
    return <Text color={theme.stageDone}>saved</Text>;
  }

  return null;
}
