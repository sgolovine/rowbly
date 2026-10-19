import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  type EditorMode,
  Loading,
  SelectList,
  Text,
  useAsync,
  useFullScreenEditor,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { openSpec } from './openSpec';
import { deleteSpec, linkedSpecs, listStorySpecs, readSpec, type Spec, type SpecTarget, specLine } from './specs';

/** A document in the list: one of the Story's Story Specs, or a linked Board Spec (`null` when it is missing). */
interface SpecDocument {
  key: string;
  target: SpecTarget;
  spec: Spec | null;
}

/**
 * The Story's Spec documents: its Story Specs, then the Board Specs it links to. `enter` (or a click)
 * opens one in the full-screen editor to read, `e` to edit; `n` creates a Story Spec, `d` deletes one.
 */
export function SpecTab({ story, active, plugin, ui }: PluginStoryTabProps<Record<string, unknown>>) {
  const isActive = useIsActive() && active;
  const editor = useFullScreenEditor();
  const [highlighted, setHighlighted] = useState<string>();
  const [deleting, setDeleting] = useState<SpecDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const documents = useAsync(async () => {
    const own: SpecDocument[] = (await listStorySpecs(plugin, story)).map((spec) => ({
      key: `story:${spec.slug}`,
      target: { board: story.boardId, story: story.key, slug: spec.slug },
      spec,
    }));
    const linked: SpecDocument[] = [];
    for (const slug of linkedSpecs(plugin, story)) {
      const target = { board: story.boardId, slug };
      linked.push({ key: `board:${slug}`, target, spec: await readSpec(plugin, target) });
    }
    return [...own, ...linked];
  }, [plugin, story]);
  // Reloads on return from the Spec form and from the editor.
  useReloadOnReturn(documents.reload, isActive);
  const data = documents.data;
  const current = data?.find((d) => d.key === highlighted) ?? data?.[0];
  const listing = isActive && !!data && !deleting && !busy && !editor.isOpen;

  const open = (document: SpecDocument, mode: EditorMode) => {
    if (!document.spec) {
      ui.toast(`Board Spec "${document.target.slug}" not found`, 'warning');
      return;
    }
    openSpec(editor, plugin, document.target, document.spec, mode);
  };
  useKeyHints(
    listing
      ? [
          { key: 'tab/←/→', description: 'switch tab' },
          ...(current ? [{ key: 'enter', description: 'open Spec' }] : []),
          ...(current?.spec ? [{ key: 'e', description: 'edit Spec' }] : []),
          { key: 'n', description: 'new Story Spec' },
          ...(current?.target.story ? [{ key: 'd', description: 'delete Story Spec' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') ui.open('form', { board: story.boardId, story: story.key, title: 'New Spec' });
      else if (input === 'e' && current) open(current, 'edit');
      else if (input === 'd' && current?.target.story) setDeleting(current);
    },
    { isActive: listing },
  );

  const remove = async (document: SpecDocument) => {
    setBusy(true);
    try {
      await deleteSpec(plugin, document.target);
      ui.toast('Deleted Story Spec');
      documents.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };
  // A reload, e.g. on return from the Spec form, keeps the list on screen, so its keys keep working.
  if (!data) return documents.loading ? <Loading /> : <Text color="red">Could not load Specs.</Text>;
  if (deleting)
    return (
      <ConfirmDialog
        message={`Delete Story Spec "${deleting.target.slug}"?`}
        destructive
        isActive={isActive && !busy}
        onConfirm={() => void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    );
  return (
    <Box flexDirection="column">
      <SelectList
        items={data.map((d) => ({
          value: d.key,
          label: d.spec ? specLine(d.spec) : `${d.target.slug}  (missing)`,
          description: d.target.story ? 'Story Spec' : 'Board Spec',
        }))}
        onHighlight={(item) => setHighlighted(item?.value)}
        onSelect={({ value }) => {
          const document = data.find((d) => d.key === value);
          if (document) open(document, 'view');
        }}
        emptyText="No Specs. Press n to create a Story Spec."
        isActive={listing}
      />
      {editor.inline}
    </Box>
  );
}
