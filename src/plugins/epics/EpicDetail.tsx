import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  DetailView,
  Loading,
  SelectList,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { deleteEpic, progressText, setEpicClosed, showEpic } from './service';

export function EpicDetail({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const id = String(params.id);
  const active = useIsActive();
  const data = useAsync(() => showEpic(plugin, id), [plugin, id]);
  // Back from the Epic form or a Story shows what changed there.
  useReloadOnReturn(data.reload);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useKeyCapture(active && confirming, { escape: true });
  useKeyHints(
    confirming
      ? [{ key: 'y/n', description: 'confirm/cancel' }]
      : [
          { key: 'enter', description: 'open Story' },
          { key: 'e', description: 'edit' },
          { key: 'c', description: data.data?.closed ? 'reopen' : 'close' },
          { key: 'd', description: 'delete' },
        ],
  );
  const changeClosed = async () => {
    if (!data.data || busy) return;
    setBusy(true);
    try {
      await setEpicClosed(plugin, id, !data.data.closed);
      ui.toast(`${data.data.closed ? 'Reopened' : 'Closed'} Epic ${id}`);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteEpic(plugin, id);
      ui.toast(`Deleted Epic ${id}`);
      ui.back();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  useInput(
    (input) => {
      if (!data.data) return;
      if (input === 'e') ui.open('form', { id, title: `Edit ${id}` });
      else if (input === 'c') void changeClosed();
      else if (input === 'd') setConfirming(true);
    },
    { isActive: active && !confirming && !busy },
  );
  if (!data.data)
    return data.loading ? <Loading label="Loading Epic…" /> : <Text color="red">Could not load Epic.</Text>;
  const epic = data.data;
  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: 'Epic', value: epic.id },
          { label: 'Name', value: epic.name },
          { label: 'Closed', value: epic.closed ? 'yes' : 'no' },
          { label: 'Epic Progress', value: progressText(epic.progress) },
        ]}
        body={epic.description}
      />
      <SelectList
        items={epic.boards.flatMap(({ board, stories }) =>
          stories.map((story) => ({
            value: story.key,
            label: `${story.key} · ${story.name} · ${story.stage}`,
            description: `Board: ${board.name} (${board.id})`,
          })),
        )}
        emptyText="No Stories."
        isActive={!confirming && !busy}
        onSelect={({ value }) => ui.openStory(value)}
      />
      {confirming && (
        <ConfirmDialog
          destructive
          message={`Delete Epic "${id}"? ${epic.progress.total} Stories will be unlinked.`}
          isActive={!busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Box>
  );
}
