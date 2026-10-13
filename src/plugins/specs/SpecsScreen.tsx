import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import { listSpecs } from './specs';

export function SpecsScreen({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const [board, setBoard] = useState(typeof params.board === 'string' ? params.board : undefined);
  const active = useIsActive();
  const boards = useAsync(async () => {
    const all = await plugin.services.boards.list();
    if (!board) {
      const current = await plugin.services.context.resolveBoard().catch(() => undefined);
      if (current) setBoard(current);
    }
    return all;
  }, [plugin]);
  const specs = useAsync(() => (board ? listSpecs(plugin, board) : Promise.resolve([])), [plugin, board, active]);
  useKeyHints(
    board
      ? [
          { key: 'n', description: 'new Spec' },
          { key: 'b', description: 'choose Board' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n' && board) ui.open('form', { board, create: true });
      if (input === 'b') setBoard(undefined);
    },
    { isActive: active },
  );
  if (boards.loading || specs.loading) return <Loading />;
  return (
    <Box flexDirection="column">
      <Text bold>{board ? `Board Specs — ${board}` : 'Choose a Board for Specs'}</Text>
      {board ? (
        <SelectList
          items={(specs.data ?? []).map((s) => ({ value: s.slug as string, label: `${s.slug}  ${s.title}` }))}
          onSelect={({ value }) => ui.open('detail', { board, slug: value })}
          emptyText="No Board Specs. Press n to create one."
        />
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
