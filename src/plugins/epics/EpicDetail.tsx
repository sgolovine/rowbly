import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  DetailView,
  Loading,
  Text,
  useAsync,
  useInput,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useState,
} from '../../plugin-api/tui';
import { deleteEpic, progressText, setEpicClosed, showEpic } from './service';

export function EpicDetail({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const id = String(params.id);
  const active = useIsActive();
  const data = useAsync(() => showEpic(plugin, id), [plugin, id, active]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useKeyCapture(active && confirming, { escape: true });
  useKeyHints(
    confirming
      ? [{ key: 'y/n', description: 'confirm/cancel' }]
      : [
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
      {epic.boards.length === 0 && <Text dimColor>No Stories.</Text>}
      {epic.boards.map(({ board, stories }) => (
        <Box key={board.id} flexDirection="column">
          <Text bold>{`Board: ${board.name} (${board.id})`}</Text>
          {stories.map((story) => (
            <Text key={story.key}>{`${story.key} · ${story.name} · ${story.stage}`}</Text>
          ))}
        </Box>
      ))}
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
