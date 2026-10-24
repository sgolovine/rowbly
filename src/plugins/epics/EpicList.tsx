import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  type ContextMenuItem,
  Loading,
  SelectList,
  Text,
  theme,
  useAsync,
  useContextMenu,
  useInput,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRef,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import type { EpicMode, EpicSummary } from './model';
import { deleteEpic, listEpicSummaries, progressText, setEpicClosed } from './service';

function nextEpicMode(mode: EpicMode): EpicMode {
  switch (mode) {
    case 'open':
      return 'closed';
    case 'closed':
      return 'all';
    case 'all':
      return 'open';
  }
}

/**
 * The Epics in a mode (`a` cycles open, closed and all). `e` edits, `c` closes or reopens and `d` deletes
 * the highlighted Epic, as on its own screen; a right click on an Epic highlights it and opens a menu of
 * those keys. An Epic file that cannot be read is listed but takes none of them.
 */
export function EpicList({ plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const contextMenu = useContextMenu();
  const [mode, setMode] = useState<EpicMode>('open');
  const data = useAsync(() => listEpicSummaries(plugin, mode), [plugin, mode]);
  // Back from an Epic or its form shows what changed there.
  useReloadOnReturn(data.reload);
  const [highlighted, setHighlighted] = useState<string | undefined>();
  const [filtering, setFiltering] = useState(false);
  const [confirming, setConfirming] = useState<EpicSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const epics = data.data?.summaries ?? [];
  const epic = epics.find((e) => e.id === highlighted);
  const idle = !filtering && !confirming && !busy;
  const keys = active && idle;
  useKeyCapture(active && confirming !== null, { escape: true });
  useKeyHints(
    confirming
      ? [{ key: 'y/n', description: 'confirm/cancel' }]
      : keys
        ? [
            { key: 'n', description: 'new Epic' },
            { key: 'a', description: 'open/closed/all' },
            { key: 'enter', description: 'open Epic' },
            ...(epic
              ? [
                  { key: 'e', description: 'edit' },
                  { key: 'c', description: epic.closed ? 'reopen' : 'close' },
                  { key: 'd', description: 'delete' },
                ]
              : []),
          ]
        : [],
  );

  const open = (id: string) => {
    const broken = data.data?.unavailable.find((file) => file.id === id);
    if (broken) ui.toast(`Epic "${broken.id}" is unavailable; run \`rowbly doctor\``, 'warning');
    else ui.open('detail', { id, title: id });
  };
  const edit = (target: EpicSummary) => ui.open('form', { id: target.id, title: `Edit ${target.id}` });
  const changeClosed = async (target: EpicSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await setEpicClosed(plugin, target.id, !target.closed);
      ui.toast(`${target.closed ? 'Reopened' : 'Closed'} Epic ${target.id}`);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (target: EpicSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteEpic(plugin, target.id);
      ui.toast(`Deleted Epic ${target.id}`);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  // What the keys act on as last rendered, for a context menu's items: an item runs after the renders
  // that opening the menu caused, such as the one that highlighted the Epic. The open menu makes the
  // screen inactive, so `idle` leaves that out.
  const latest = useRef({ epic, idle });
  latest.current = { epic, idle };
  /** A right click on an Epic highlights it and opens a menu of what its keys do. */
  const epicMenu = (id: string, x: number, y: number) => {
    const target = epics.find((e) => e.id === id);
    if (!target || !keys) return;
    // Runs only if the Epic is still highlighted and the keys still work.
    const act = (run: () => void) => () => {
      if (latest.current.idle && latest.current.epic?.id === target.id) run();
    };
    const items: ContextMenuItem[] = [
      { label: 'Open', key: 'enter', onSelect: act(() => open(target.id)) },
      { label: 'Edit', key: 'e', onSelect: act(() => edit(target)) },
      { label: target.closed ? 'Reopen' : 'Close', key: 'c', onSelect: act(() => void changeClosed(target)) },
      { label: 'Delete', key: 'd', onSelect: act(() => setConfirming(target)) },
    ];
    contextMenu.open(x, y, items);
  };

  useInput(
    (input) => {
      if (input === 'n') ui.open('form', { title: 'New Epic' });
      else if (input === 'a') setMode(nextEpicMode);
      else if (!epic) return;
      else if (input === 'e') edit(epic);
      else if (input === 'c') void changeClosed(epic);
      else if (input === 'd') setConfirming(epic);
    },
    { isActive: keys },
  );
  if (!data.data)
    return data.loading ? <Loading label="Loading Epics…" /> : <Text color={theme.danger}>Could not load Epics.</Text>;
  const { summaries, unavailable } = data.data;
  return (
    <Box flexDirection="column" gap={confirming ? 1 : 0}>
      <Text bold>{`Epics (${mode})`}</Text>
      <SelectList
        items={[
          ...summaries.map((epic) => ({
            value: epic.id,
            label: `${epic.id} · ${epic.name}`,
            description: `${epic.closed ? 'closed · ' : ''}${progressText(epic.progress)}`,
          })),
          ...unavailable.map((file) => ({
            value: file.id,
            label: `${file.id} · unavailable`,
            description: `${file.path}: ${file.message}`,
          })),
        ]}
        emptyText="No Epics."
        isActive={!confirming && !busy}
        onHighlight={(item) => setHighlighted(item?.value)}
        onFilteringChange={setFiltering}
        onSelect={({ value }) => open(value)}
        onContextMenu={({ value }, x, y) => epicMenu(value, x, y)}
      />
      {confirming && (
        <ConfirmDialog
          destructive
          message={`Delete Epic "${confirming.id}"? ${confirming.progress.total} Stories will be unlinked.`}
          isActive={!busy}
          onConfirm={() => void remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </Box>
  );
}
