import type { PluginStageHeaderProps } from '../../plugin-api';
import { Button, useFullScreenEditor, useIsActive, useState } from '../../plugin-api/tui';
import { boardOverview, setStagePrompt, templateText } from './stagePrompts';

/** Opens the effective prompt, saving edits at the Board level. */
export function StagePromptHeader({ boardId, stage, active, plugin, ui }: PluginStageHeaderProps) {
  const editor = useFullScreenEditor();
  const focused = useIsActive();
  const [busy, setBusy] = useState(false);
  const enabled = active && focused && !busy && !editor.isOpen;
  const open = async () => {
    if (!enabled) return;
    setBusy(true);
    try {
      const row = (await boardOverview(plugin, boardId)).stages.find((row) => row.key === stage.key);
      if (!row) throw new Error(`Stage "${stage.name}" is no longer on Board "${boardId}"`);
      editor.open({
        title: `Stage Prompt ${stage.name} · Board ${boardId}`,
        initial: row.prompt.text ?? templateText(row),
        mode: 'view',
        onSave: async (text) => {
          await setStagePrompt(plugin, { level: 'board', board: boardId, stage: stage.key }, { text });
        },
      });
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button label="✎" compact clickable={enabled} busy={busy} onClick={() => void open()} />
      {editor.inline}
    </>
  );
}
