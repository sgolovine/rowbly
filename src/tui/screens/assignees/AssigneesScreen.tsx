import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import type { Assignee } from '../../../schemas';
import { ConfirmDialog, DetailView, Form, Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/**
 * The Assignee roster of `params.workspaceId` (default: the current Workspace). Views picked by
 * `params.view`: the list (default), `detail` for one Assignee, and the `create` / `edit` forms.
 */
export function AssigneesScreen({ params }: ScreenProps) {
  const services = useServices();
  const given = typeof params.workspaceId === 'string' ? params.workspaceId : undefined;
  const workspace = useAsync(async () => given ?? services.context.resolveWorkspace(), [given]);
  if (!workspace.data) return workspace.loading ? <Loading label="Loading workspace…" /> : null;

  const ws = workspace.data;
  const handle = typeof params.handle === 'string' ? params.handle : '';
  if (params.view === 'detail') return <AssigneeDetail ws={ws} handle={handle} />;
  if (params.view === 'create') return <AssigneeForm ws={ws} />;
  if (params.view === 'edit') return <AssigneeForm ws={ws} handle={handle} />;
  return <AssigneeList ws={ws} />;
}

/** Loads the roster again whenever the screen comes back to the top, e.g. after a form closes. */
function useRoster(ws: string) {
  const services = useServices();
  const active = useIsActive();
  return useAsync(() => services.assignees.list(ws), [ws, active]);
}

function AssigneeList({ ws }: { ws: string }) {
  const ctx = useRowblyContext();
  const router = useRouter();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const roster = useRoster(ws);
  useKeyHints([
    { key: 'enter', description: 'open' },
    { key: 'n', description: 'add assignee' },
  ]);
  useInput(
    (input) => {
      if (input === 'n' && !shell.captured().text) {
        router.push('assignees', { view: 'create', workspaceId: ws, title: 'New Assignee' });
      }
    },
    { isActive: active },
  );

  if (!roster.data) return roster.loading ? <Loading label="Loading assignees…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>Assignees in {ws}</Text>
      <SelectList
        items={roster.data.map((a) => ({
          value: a.handle,
          label: a.handle === ctx?.me ? `${a.handle} (me)` : a.handle,
          description: a.email ? `${a.name} <${a.email}>` : a.name,
        }))}
        emptyText="No Assignees yet. Press n to add one."
        onSelect={(item) =>
          router.push('assignees', { view: 'detail', workspaceId: ws, handle: item.value, title: item.value })
        }
      />
    </Box>
  );
}

function AssigneeDetail({ ws, handle }: { ws: string; handle: string }) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const roster = useRoster(ws);
  const [confirming, setConfirming] = useState(false);
  useKeyHints([{ key: 'enter', description: 'run action' }]);

  if (!roster.data) return roster.loading ? <Loading label="Loading assignee…" /> : null;
  const assignee = roster.data.find((a) => a.handle === handle);
  if (!assignee) return <Text dimColor>Assignee "{handle}" is no longer in the roster.</Text>;

  const remove = async () => {
    try {
      // The service warns with the number of Stories it updated; the shell shows that as a toast.
      await services.assignees.remove(ws, handle);
      toast.push('info', `Removed Assignee ${handle}`);
      router.pop();
    } catch (err) {
      toast.error(err);
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
          message={`Remove Assignee "${handle}"? They are also removed from every Story in ${ws}.`}
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
            if (item.value === 'edit') {
              router.push('assignees', { view: 'edit', workspaceId: ws, handle, title: `Edit ${handle}` });
            } else setConfirming(true);
          }}
        />
      )}
    </Box>
  );
}

function AssigneeForm({ ws, handle }: { ws: string; handle?: string }) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const roster = useAsync(() => services.assignees.list(ws), [ws]);
  if (!roster.data) return roster.loading ? <Loading label="Loading assignee…" /> : null;
  const current: Assignee | undefined = handle ? roster.data.find((a) => a.handle === handle) : undefined;
  if (handle && !current) return <Text dimColor>Assignee "{handle}" is no longer in the roster.</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>{current ? `Edit Assignee ${current.handle}` : `New Assignee in ${ws}`}</Text>
      <Form
        fields={[
          ...(current ? [] : [{ name: 'handle', label: 'Handle', kind: 'text' as const, required: true }]),
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'email', label: 'Email', kind: 'text' },
        ]}
        initialValues={current ? { name: current.name, email: current.email ?? '' } : {}}
        onSubmit={async (values) => {
          const name = String(values.name);
          const email = String(values.email ?? '');
          if (current) {
            await services.assignees.update(ws, current.handle, { name, email: email || null });
            toast.push('info', `Updated Assignee ${current.handle}`);
          } else {
            const added = await services.assignees.add(ws, { handle: String(values.handle), name, email });
            toast.push('info', `Added Assignee ${added.handle}`);
          }
          router.pop();
        }}
      />
    </Box>
  );
}
