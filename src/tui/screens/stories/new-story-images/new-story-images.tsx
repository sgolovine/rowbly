import { Text } from "ink";
import { useEffect } from "react";
import { useStoryPaste } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

/** Owns paste inside the Modal's focus and overlay context. */
export function NewStoryImages({
  onPaste,
  enabled = true,
}: {
  enabled?: boolean;
  onPaste(value: ReturnType<typeof useStoryPaste>): void;
}) {
  const paste = useStoryPaste("new Story", undefined, enabled);

  // No dependencies: the parent reads the paste state of the last render.
  useEffect(() => {
    onPaste(paste);
  });

  return paste.summary ? <Text color={theme.inkMuted}>{paste.summary}</Text> : null;
}
