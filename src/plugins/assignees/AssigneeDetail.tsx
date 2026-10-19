import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  DetailView,
  Loading,
  SelectList,
  Text,
  useAsync,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { listAssignees } from './roster';
import { removeAssignee } from './service';

/** One Assignee, with Edit and Remove. */
export function AssigneeDetail({ params, plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const handle = String(params.handle);
  const roster = useAsync(() => listAssignees(plugin), [plugin]);
  // Back from the form shows the edit.
  useReloadOnReturn(roster.reload);
  const [confirming, setConfirming] = useState(false);
  useKeyHints([{ key: 'enter', description: 'run action' }]);

  if (!roster.data)
    return roster.loading ? <Loading label="Loading assignee…" /> : <Text color="red">Could not load Assignee.</Text>;
  const assignee = roster.data.find((a) => a.handle === handle);
  if (!assignee) return <Text dimColor>Assignee "{handle}" is no longer in the roster.</Text>;

  const remove = async () => {
    try {
      // The Plugin warns with the number of Stories it updated; the shell shows that as a toast.
      await removeAssignee(plugin, handle);
      ui.toast(`Removed Assignee ${handle}`);
      ui.back();
    } catch (err) {
      ui.error(err);
      setConfirming(false);
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: 'Handle', value: assignee.handle },
          { label: 'Name', value: assignee.name },
          { label: 'Email', value: assignee.email ?? '—' },
        ]}
      />
      {confirming ? (
        <ConfirmDialog
          message={`Remove Assignee "${handle}"? They are also removed from every Story.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <SelectList
          items={[
            { value: 'edit', label: 'Edit', description: 'name and email' },
            { value: 'remove', label: 'Remove', description: 'from the roster and all Stories' },
          ]}
          onSelect={(item) => {
            if (item.value === 'edit') ui.open('form', { handle, title: `Edit ${handle}` });
            else setConfirming(true);
          }}
        />
      )}
    </Box>
  );
}
