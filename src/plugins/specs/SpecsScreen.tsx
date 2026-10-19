import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  Loading,
  SelectList,
  Text,
  useAsync,
  useEffect,
  useFullScreenEditor,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { openSpec } from './openSpec';
import { deleteSpec, listSpecs, type Spec, specLine } from './specs';

/**
 * The Board Specs of one Board. `board` is `undefined` until the context's Board is known, `null`
 * while the person chooses a Board, and the chosen Board's id after that. `enter` (or a click) opens
 * a Board Spec in the full-screen editor to read, `e` to edit; `n` creates one, `d` deletes one.
 */
export function SpecsScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const [board, setBoard] = useState<string | null | undefined>(
    typeof params.board === 'string' ? params.board : undefined,
  );
  const active = useIsActive();
  const editor = useFullScreenEditor();
  const [highlighted, setHighlighted] = useState<string>();
  const [deleting, setDeleting] = useState<Spec | null>(null);
  const [busy, setBusy] = useState(false);
  // The context's Board only fills a still-unresolved choice, so a late answer never replaces the person's.
  useEffect(() => {
    let current = true;
    plugin.services.context
      .resolveBoard()
      .catch(() => undefined)
      .then((resolved) => {
        if (current) setBoard((previous) => (previous === undefined ? (resolved ?? null) : previous));
      });
    return () => {
      current = false;
    };
  }, [plugin]);
  const boards = useAsync(() => plugin.services.boards.list(), [plugin]);
  const specs = useAsync(() => (board ? listSpecs(plugin, board) : Promise.resolve([])), [plugin, board]);
  // Reloads on return from the Spec form and from the editor.
  useReloadOnReturn(specs.reload, active);
  const listing = typeof board === 'string' && !specs.loading && !specs.error;
  const current = specs.data?.find((s) => s.slug === highlighted) ?? specs.data?.[0];
  const keys = active && !deleting && !busy && !editor.isOpen;
  useKeyHints(
    typeof board === 'string' && !deleting
      ? [
          ...(listing && current
            ? [
                { key: 'enter', description: 'open Spec' },
                { key: 'e', description: 'edit Spec' },
                { key: 'd', description: 'delete Spec' },
              ]
            : []),
          ...(listing ? [{ key: 'n', description: 'new Spec' }] : []),
          { key: 'b', description: 'choose Board' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (typeof board !== 'string') return;
      if (input === 'n' && listing) ui.open('form', { board, title: 'New Spec' });
      else if (input === 'e' && listing && current)
        openSpec(editor, plugin, { board, slug: current.slug }, current, 'edit');
      else if (input === 'd' && listing && current) setDeleting(current);
      else if (input === 'b') setBoard(null);
    },
    { isActive: keys },
  );
  const remove = async (spec: Spec) => {
    if (typeof board !== 'string') return;
    setBusy(true);
    try {
      await deleteSpec(plugin, { board, slug: spec.slug });
      ui.toast('Deleted Spec');
      specs.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };
  if (board === undefined) return <Loading />;
  if (board === null) {
    if (boards.loading) return <Loading />;
    return (
      <Box flexDirection="column">
        <Text bold>Choose a Board for Specs</Text>
        {boards.error ? (
          <Text color="red">Could not load Boards.</Text>
        ) : (
          <SelectList
            items={(boards.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            onSelect={({ value }) => setBoard(value)}
            emptyText="No Boards."
          />
        )}
      </Box>
    );
  }
  // A reload, e.g. on return from a Spec, keeps the list on screen, so its keys keep working.
  if (specs.loading && !specs.data?.length) return <Loading />;
  if (deleting)
    return (
      <ConfirmDialog
        message={`Delete Spec "${deleting.slug}"? Board Spec links will be removed.`}
        destructive
        isActive={active && !busy}
        onConfirm={() => void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    );
  return (
    <Box flexDirection="column">
      <Text bold>{`Board Specs — ${board}`}</Text>
      {specs.error ? (
        <Text color="red">Could not load Specs.</Text>
      ) : (
        <SelectList
          items={(specs.data ?? []).map((s) => ({ value: s.slug, label: specLine(s) }))}
          onHighlight={(item) => setHighlighted(item?.value)}
          onSelect={({ value }) => {
            const spec = specs.data?.find((s) => s.slug === value);
            if (spec) openSpec(editor, plugin, { board, slug: spec.slug }, spec, 'view');
          }}
          emptyText="No Board Specs. Press n to create one."
          isActive={keys}
        />
      )}
      {editor.inline}
    </Box>
  );
}
