import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  Loading,
  SelectList,
  Text,
  theme,
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
  const [filtering, setFiltering] = useState(false);
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
  // The list names its Board, so a list still on screen while another Board's loads is never acted on.
  const specs = useAsync(
    async () => (board ? { board, specs: await listSpecs(plugin, board) } : null),
    [plugin, board],
  );
  // Reloads on return from the Spec form and from the editor.
  useReloadOnReturn(specs.reload, active);
  // A reload keeps the list, and its keys, on screen; another Board's list is not this one.
  const list = !specs.error && specs.data?.board === board ? specs.data : undefined;
  const current = list?.specs.find((s) => s.slug === highlighted) ?? list?.specs[0];
  const listing = active && !deleting && !busy && !editor.isOpen;
  const keys = listing && !filtering;
  useKeyHints(
    typeof board === 'string' && keys
      ? [
          ...(list && current
            ? [
                { key: 'enter', description: 'open Spec' },
                { key: 'e', description: 'edit Spec' },
                { key: 'd', description: 'delete Spec' },
              ]
            : []),
          ...(list ? [{ key: 'n', description: 'new Spec' }] : []),
          { key: 'b', description: 'choose Board' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'b' && typeof board === 'string') setBoard(null);
      if (!list) return;
      if (input === 'n') ui.open('form', { board: list.board, title: 'New Spec' });
      else if (input === 'e' && current)
        openSpec(editor, plugin, { board: list.board, slug: current.slug }, current, 'edit');
      else if (input === 'd' && current) setDeleting(current);
    },
    { isActive: keys },
  );
  const remove = async (spec: Spec) => {
    if (!list) return;
    setBusy(true);
    try {
      await deleteSpec(plugin, { board: list.board, slug: spec.slug });
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
          <Text color={theme.danger}>Could not load Boards.</Text>
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
  if (!list && !specs.error) return <Loading />;
  return (
    <Box flexDirection="column">
      <Text bold>{`Board Specs — ${board}`}</Text>
      {!list ? (
        <Text color={theme.danger}>Could not load Specs.</Text>
      ) : (
        <SelectList
          items={list.specs.map((s) => ({ value: s.slug, label: specLine(s) }))}
          onFilteringChange={setFiltering}
          onHighlight={(item) => setHighlighted(item?.value)}
          onSelect={({ value }) => {
            const spec = list.specs.find((s) => s.slug === value);
            if (spec) openSpec(editor, plugin, { board: list.board, slug: spec.slug }, spec, 'view');
          }}
          emptyText="No Board Specs. Press n to create one."
          isActive={listing}
        />
      )}
      {/* The list stays under the confirmation, so its highlight is kept when the person cancels. */}
      {deleting && (
        <ConfirmDialog
          message={`Delete Spec "${deleting.slug}"? Board Spec links will be removed.`}
          destructive
          isActive={active && !busy}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
      {editor.inline}
    </Box>
  );
}
