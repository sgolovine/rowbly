import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  useAsync,
  useEffect,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { listSpecs, specLine } from './specs';

/**
 * The Board Specs of one Board. `board` is `undefined` until the context's Board is known, `null`
 * while the person chooses a Board, and the chosen Board's id after that.
 */
export function SpecsScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const [board, setBoard] = useState<string | null | undefined>(
    typeof params.board === 'string' ? params.board : undefined,
  );
  const active = useIsActive();
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
  useReloadOnReturn(specs.reload, active);
  const listing = typeof board === 'string' && !specs.loading && !specs.error;
  useKeyHints(
    typeof board === 'string'
      ? [...(listing ? [{ key: 'n', description: 'new Spec' }] : []), { key: 'b', description: 'choose Board' }]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n' && listing) ui.open('form', { board, create: true, title: 'New Spec' });
      if (input === 'b') setBoard(null);
    },
    { isActive: active },
  );
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
  return (
    <Box flexDirection="column">
      <Text bold>{`Board Specs — ${board}`}</Text>
      {specs.error ? (
        <Text color="red">Could not load Specs.</Text>
      ) : (
        <SelectList
          items={(specs.data ?? []).map((s) => ({ value: s.slug, label: specLine(s) }))}
          onSelect={({ value }) => ui.open('detail', { board, slug: value, title: value })}
          emptyText="No Board Specs. Press n to create one."
        />
      )}
    </Box>
  );
}
