import { useApp } from 'ink';
import { useCallback } from 'react';
import { editTextInEditor } from '../../storage';

/**
 * Returns `edit(initial)`, which suspends Ink, opens `$VISUAL`/`$EDITOR` (fallback `vi`) on a temp
 * file holding `initial`, resumes Ink and resolves with the saved text.
 */
export function useEditor(): (initial: string) => Promise<string> {
  const { suspendTerminal } = useApp();
  return useCallback(
    async (initial: string) => {
      let text = initial;
      await suspendTerminal(async () => {
        text = await editTextInEditor(initial);
      });
      return text;
    },
    [suspendTerminal],
  );
}
