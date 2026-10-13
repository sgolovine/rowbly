import type { PluginScreenProps } from '../../plugin-api';
import { ConfirmDialog, Loading, useAsync, useInput, useIsActive, useKeyHints, useState } from '../../plugin-api/tui';
import { SpecText } from './SpecText';
import { deleteSpec, getSpec, type SpecTarget } from './specs';

export function SpecDetailScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const target = params as unknown as SpecTarget;
  const active = useIsActive();
  const spec = useAsync(() => getSpec(plugin, target), [plugin, target.board, target.story, target.slug, active]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useKeyHints([
    { key: 'e', description: 'edit Spec' },
    { key: 'd', description: 'delete Spec' },
    { key: '↑/↓', description: 'scroll Spec' },
  ]);
  useInput(
    (input) => {
      if (input === 'e') ui.open('form', { ...target, create: false });
      if (input === 'd') setConfirm(true);
    },
    { isActive: active && !confirm && !busy },
  );
  const remove = async () => {
    setBusy(true);
    try {
      await deleteSpec(plugin, target);
      ui.toast('Deleted Spec');
      ui.back();
    } catch (err) {
      ui.error(err);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  if (spec.loading) return <Loading />;
  if (!spec.data) return null;
  if (confirm)
    return (
      <ConfirmDialog
        message="Delete Spec? Board Spec links will be removed."
        destructive
        isActive={active && !busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
    );
  return <SpecText text={spec.data.text} active={active} />;
}
