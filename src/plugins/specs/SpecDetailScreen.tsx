import type { PluginScreenProps } from '../../plugin-api';
import {
  ConfirmDialog,
  Loading,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { SpecText } from './SpecText';
import { deleteSpec, getSpec, parseSpecTarget, specTargetName } from './specs';

export function SpecDetailScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const loaded = useAsync(async () => {
    const target = parseSpecTarget(params);
    return { target, spec: await getSpec(plugin, target) };
  }, [plugin, params.board, params.story, params.slug]);
  useReloadOnReturn(loaded.reload, active);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = loaded.data;
  useKeyHints(
    data
      ? [
          { key: 'e', description: 'edit Spec' },
          { key: 'd', description: 'delete Spec' },
          { key: '↑/↓', description: 'scroll Spec' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (!data) return;
      if (input === 'e')
        ui.open('form', { ...data.target, create: false, title: `Edit ${specTargetName(data.target)}` });
      if (input === 'd') setConfirming(true);
    },
    { isActive: active && !confirming && !busy && !!data },
  );
  const remove = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await deleteSpec(plugin, data.target);
      ui.toast('Deleted Spec');
      ui.back();
    } catch (err) {
      ui.error(err);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  // A reload on return from the form keeps the Spec on screen.
  if (loaded.loading && !data) return <Loading />;
  if (!data) return <Text color="red">Could not load Spec.</Text>;
  if (confirming)
    return (
      <ConfirmDialog
        message={`Delete Spec "${specTargetName(data.target)}"?${data.target.story ? '' : ' Board Spec links will be removed.'}`}
        destructive
        isActive={active && !busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    );
  return <SpecText text={data.spec.text} active={active} />;
}
