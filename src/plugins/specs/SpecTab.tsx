import type { PluginStoryTabProps } from '../../plugin-api';
import { ConfirmDialog, Loading, useAsync, useInput, useIsActive, useKeyHints, useState } from '../../plugin-api/tui';
import { SpecText } from './SpecText';
import { deleteSpec, linkedSpecs, readSpec } from './specs';

export function SpecTab({ story, active, plugin, ui }: PluginStoryTabProps<Record<string, unknown>>) {
  const isActive = useIsActive() && active;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const documents = useAsync(async () => {
    const own = await readSpec(plugin, { board: story.boardId, story: story.key });
    const linked = [];
    for (const slug of linkedSpecs(plugin, story)) {
      linked.push({ slug, spec: await readSpec(plugin, { board: story.boardId, slug }) });
    }
    return { own, linked };
  }, [plugin, story, isActive]);
  useKeyHints(
    isActive
      ? [
          { key: 'e', description: documents.data?.own ? 'edit Story Spec' : 'create Story Spec' },
          { key: '↑/↓', description: 'scroll Specs' },
          ...(documents.data?.own ? [{ key: 'd', description: 'delete Story Spec' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'e') ui.open('form', { board: story.boardId, story: story.key, create: !documents.data?.own });
      if (input === 'd' && documents.data?.own) setConfirm(true);
    },
    { isActive: isActive && !confirm && !busy && !documents.loading },
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
      setConfirm(false);
    }
  };
  if (documents.loading) return <Loading />;
  if (confirm)
    return (
      <ConfirmDialog
        message="Delete Story Spec?"
        destructive
        isActive={isActive && !busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
    );

  const text = [
    `Story Spec\n${documents.data?.own?.text ?? 'No Story Spec. Press e to create one.'}`,
    ...(documents.data?.linked ?? []).map(
      ({ slug, spec }) => `Board Spec: ${slug}\n${spec?.text ?? 'Missing Board Spec'}`,
    ),
  ].join('\n\n');
  return <SpecText text={text} active={isActive} reservedRows={4} />;
}
