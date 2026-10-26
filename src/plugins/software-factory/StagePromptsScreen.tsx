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
import {
  boardOverview,
  type Level,
  levelOverview,
  removeStagePrompt,
  type StagePromptRow,
  setStagePrompt,
  templateText,
} from './stagePrompts';

/** What a row says after the Stage name: on or off, and the level it comes from. */
function describe(row: StagePromptRow): string {
  const { prompt } = row;
  const setting = prompt.enabled ? 'on' : prompt.configured ? 'on, file missing' : 'off';
  return prompt.source ? `${setting} · ${prompt.source}` : setting;
}

/**
 * The Stage Prompts of the context's Board (effective: a Board entry replaces the global one) or of
 * the global level. `space` turns the highlighted Stage's prompt on or off at the shown level, `enter`
 * reads it, `e` edits it, `d` removes it at the shown level and `l` switches level.
 */
export function StagePromptsScreen({ plugin, ui }: PluginScreenProps) {
  const active = useIsActive();
  const editor = useFullScreenEditor();
  // `undefined` until the context's Board is known; `null` when there is none (global level only).
  const [board, setBoard] = useState<string | null | undefined>(undefined);
  const [level, setLevel] = useState<Level>('board');
  const [filtering, setFiltering] = useState(false);
  const [highlighted, setHighlighted] = useState<string>();
  const [removing, setRemoving] = useState<StagePromptRow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    plugin.services.context
      .resolveBoard()
      .catch(() => null)
      .then((resolved) => {
        if (!current) return;
        setBoard(resolved ?? null);
        if (!resolved) setLevel('global');
      });
    return () => {
      current = false;
    };
  }, [plugin]);
  const shown = useAsync(
    async () =>
      board === undefined
        ? null
        : {
            level,
            overview:
              level === 'board' && board
                ? await boardOverview(plugin, board)
                : await levelOverview(plugin, 'global', board ?? undefined),
          },
    [plugin, board, level],
  );
  // Reloads on return from the editor; a reload keeps the list, and its keys, on screen.
  useReloadOnReturn(shown.reload, active);
  const data = !shown.error && shown.data?.level === level ? shown.data.overview : undefined;
  const current = data?.stages.find((s) => s.key === highlighted) ?? data?.stages[0];
  const listing = active && !removing && !busy && !editor.isOpen;
  const keys = listing && !filtering && !!data;
  const target = (stage: string) => ({ level, board: level === 'board' ? (board ?? undefined) : undefined, stage });
  const ownsEntry = !!current && current.prompt.source === level;
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      ui.toast(await work());
      shown.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (row: StagePromptRow) =>
    void run(async () => {
      const saved = await setStagePrompt(plugin, target(row.key), { enabled: !row.prompt.configured });
      return `Stage Prompt ${row.name} ${saved.configured ? 'on' : 'off'}`;
    });
  const open = (row: StagePromptRow, mode: 'view' | 'edit') =>
    editor.open({
      title: `Stage Prompt ${row.name}`,
      initial: row.prompt.text ?? templateText(row),
      mode,
      onSave: async (text) => {
        await setStagePrompt(plugin, target(row.key), { text });
      },
    });
  useKeyHints(
    keys && current
      ? [
          { key: 'space', description: current.prompt.configured ? 'turn off' : 'turn on' },
          ...(current.prompt.exists ? [{ key: 'enter', description: 'read' }] : []),
          { key: 'e', description: 'edit' },
          ...(ownsEntry ? [{ key: 'd', description: 'remove' }] : []),
          ...(board ? [{ key: 'l', description: 'switch level' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'l' && board) {
        // The other level's list starts at its first row, so no key acts on the Stage highlighted before.
        setHighlighted(undefined);
        setLevel(level === 'board' ? 'global' : 'board');
        return;
      }
      if (!current) return;
      if (input === ' ') toggle(current);
      else if (input === 'e') open(current, 'edit');
      else if (input === 'd' && ownsEntry) setRemoving(current);
    },
    { isActive: keys },
  );
  const remove = (row: StagePromptRow) =>
    void run(async () => {
      await removeStagePrompt(plugin, target(row.key));
      return `Removed Stage Prompt ${row.name}`;
    }).finally(() => setRemoving(null));
  if (board === undefined || (!data && !shown.error)) return <Loading />;
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={theme.inkFaint}>Level:</Text>
        {(board ? (['board', 'global'] as const) : (['global'] as const)).map((name) => (
          <Text key={name} backgroundColor={name === level ? theme.selection : undefined} color={theme.ink}>
            {` ${name === 'board' ? `Board ${board}` : 'global'} `}
          </Text>
        ))}
      </Box>
      {!data ? (
        <Text color={theme.danger}>Could not load Stage Prompts.</Text>
      ) : (
        <SelectList
          key={level}
          items={data.stages.map((row) => ({ value: row.key, label: row.name, description: describe(row) }))}
          onFilteringChange={setFiltering}
          onHighlight={(item) => setHighlighted(item?.value)}
          onSelect={({ value }) => {
            const row = data.stages.find((s) => s.key === value);
            if (row?.prompt.exists) open(row, 'view');
          }}
          emptyText="No Stages."
          isActive={listing}
        />
      )}
      <Text color={theme.inkMuted}>
        {level === 'board'
          ? "A Board's own Stage Prompt replaces the global one for that Stage."
          : 'Global Stage Prompts apply to every Board without its own for that Stage.'}
      </Text>
      {removing && (
        <ConfirmDialog
          message={`Remove the Stage Prompt of ${removing.name} at the ${level} level, with its file?`}
          destructive
          isActive={active && !busy}
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
      {editor.inline}
    </Box>
  );
}
