import type { PluginStoryTabProps } from '../../plugin-api';
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
import { deleteSpec, linkedSpecs, readSpec } from './specs';

export function SpecTab({ story, active, plugin, ui }: PluginStoryTabProps<Record<string, unknown>>) {
  const isActive = useIsActive() && active;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const documents = useAsync(async () => {
    const own = await readSpec(plugin, { board: story.boardId, story: story.key });
    const linked = [];
    for (const slug of linkedSpecs(plugin, story)) {
      linked.push({ slug, spec: await readSpec(plugin, { board: story.boardId, slug }) });
    }
    return { own, linked };
  }, [plugin, story]);
  useReloadOnReturn(documents.reload, isActive);
  const data = documents.data;
  useKeyHints(
    isActive && data
      ? [
          { key: 'e', description: data.own ? 'edit Story Spec' : 'create Story Spec' },
          { key: '↑/↓', description: 'scroll Specs' },
          ...(data.own ? [{ key: 'd', description: 'delete Story Spec' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (!data) return;
      if (input === 'e')
        ui.open('form', {
          board: story.boardId,
          story: story.key,
          create: !data.own,
          title: data.own ? `Edit ${story.key}` : 'New Spec',
        });
      if (input === 'd' && data.own) setConfirming(true);
    },
    { isActive: isActive && !confirming && !busy && !!data },
  );
  const remove = async () => {
    setBusy(true);
    try {
      await deleteSpec(plugin, { board: story.boardId, story: story.key });
      ui.toast('Deleted Story Spec');
      documents.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  // A reload, e.g. on return from the Spec form, keeps the Specs on screen, so their keys keep working.
  if (!data) return documents.loading ? <Loading /> : <Text color="red">Could not load Specs.</Text>;
  if (confirming)
    return (
      <ConfirmDialog
        message="Delete Story Spec?"
        destructive
        isActive={isActive && !busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    );

  const text = [
    `Story Spec\n${data.own?.text ?? 'No Story Spec. Press e to create one.'}`,
    ...data.linked.map(({ slug, spec }) => `Board Spec: ${slug}\n${spec?.text ?? 'Missing Board Spec'}`),
  ].join('\n\n');
  return <SpecText text={text} active={isActive} reservedRows={4} />;
}
