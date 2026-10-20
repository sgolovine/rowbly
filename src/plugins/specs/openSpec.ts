import type { PluginContext } from '../../plugin-api';
import type { EditorMode, FullScreenEditorControl } from '../../plugin-api/tui';
import { editSpec, type Spec, type SpecTarget, specTargetName } from './specs';

/**
 * Opens `spec` in the full-screen editor: `view` renders it and `edit` shows its markdown. `ctrl+s`
 * saves it as an edit of `target`. The screen below takes no keys while the editor is open, so a list
 * that reloads on return (`useReloadOnReturn`) shows the saved Spec once it closes.
 */
export function openSpec(
  editor: FullScreenEditorControl,
  plugin: PluginContext,
  target: SpecTarget,
  spec: Spec,
  mode: EditorMode,
): void {
  editor.open({
    title: `${target.story === undefined ? 'Board Spec' : 'Story Spec'} ${specTargetName(target)}`,
    initial: spec.text,
    mode,
    onSave: async (text) => {
      await editSpec(plugin, target, text);
    },
  });
}
