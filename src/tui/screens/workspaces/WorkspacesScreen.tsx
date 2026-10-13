import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { describeCascadeLevels } from '../../../output';
import { plural, workspaceOverview } from '../../../services/workspaces';
import { ConfirmDialog, DetailView, Form, Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/**
 * One screen, several views picked by `params.view`, so `esc` and the unsaved-form guard come from
 * the shell: the list (default), `detail` for one Workspace, and the `create` / `edit` forms.
 */
export function WorkspacesScreen({ params }: ScreenProps) {
  const id = typeof params.id === 'string' ? params.id : '';
  if (params.view === 'detail') return <WorkspaceDetail id={id} />;
  if (params.view === 'create') return <WorkspaceForm />;
  if (params.view === 'edit') return <WorkspaceForm id={id} />;
  return <WorkspaceList />;
}

function WorkspaceList() {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  // Reload whenever the screen comes back to the top, e.g. after a form closes.
  const workspaces = useAsync(() => services.workspaces.list(), [active]);
  useKeyHints([
    { key: 'enter', description: 'use & open' },
    { key: 'n', description: 'new workspace' },
  ]);
  useInput(
    (input) => {
      if (input === 'n' && !shell.captured().text)
        router.push('workspaces', { view: 'create', title: 'New Workspace' });
    },
    { isActive: active },
  );

  if (!workspaces.data) return workspaces.loading ? <Loading label="Loading workspaces…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>Workspaces</Text>
      <SelectList
        items={workspaces.data.map((ws) => ({
          value: ws.id,
          label: ws.id === ctx?.local.workspace ? `${ws.id} *` : ws.id,
          description: ws.name,
        }))}
        emptyText="No Workspaces yet. Press n to create one."
        onSelect={async (item) => {
          try {
            await services.context.use(item.value);
            toast.push('info', `Now using Workspace ${item.value}`);
            router.push('workspaces', { view: 'detail', id: item.value, title: item.value });
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </Box>
  );
}

type Action = 'assignees' | 'edit' | 'delete';

function WorkspaceDetail({ id }: { id: string }) {
  const ctx = useRowblyContext();
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const active = useIsActive();
  const [confirming, setConfirming] = useState(false);
  const overview = useAsync(async () => (ctx ? workspaceOverview(ctx, id) : null), [id, active]);
  useKeyHints([{ key: 'enter', description: 'run action' }]);

  if (!overview.data) return overview.loading ? <Loading label="Loading workspace…" /> : null;
  const o = overview.data;
  const nonEmpty = o.boards + o.epics > 0;

  const remove = async () => {
    try {
      await services.workspaces.remove(id, { force: nonEmpty });
      toast.push('info', `Deleted Workspace ${id}`);
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
          { label: 'Workspace', value: o.workspace.id },
          { label: 'Name', value: o.workspace.name },
          { label: 'Boards', value: String(o.boards) },
          { label: 'Epics', value: String(o.epics) },
          { label: 'Assignees', value: String(o.assignees) },
          { label: 'Stages', value: describeCascadeLevels(o.overrides.stages, 'built-in defaults') },
          { label: 'Custom Fields', value: describeCascadeLevels(o.overrides.customFields, 'none') },
        ]}
        body={o.workspace.description}
      />
      {confirming ? (
        <ConfirmDialog
          message={
            nonEmpty
              ? `Delete Workspace "${id}" and everything in it (${plural(o.boards, 'Board')}, ${plural(o.epics, 'Epic')})?`
              : `Delete Workspace "${id}"?`
          }
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <SelectList<Action>
          items={[
            { value: 'assignees', label: 'Assignees', description: 'manage the roster' },
            { value: 'edit', label: 'Edit', description: 'name and description' },
            { value: 'delete', label: 'Delete', description: nonEmpty ? 'with everything inside' : undefined },
          ]}
          onSelect={(item) => {
            if (item.value === 'assignees') router.push('assignees', { workspaceId: id, title: `Assignees (${id})` });
            else if (item.value === 'edit') router.push('workspaces', { view: 'edit', id, title: `Edit ${id}` });
            else setConfirming(true);
          }}
        />
      )}
    </Box>
  );
}

function WorkspaceForm({ id }: { id?: string }) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const current = useAsync(async () => (id ? services.workspaces.get(id) : null), [id]);
  if (current.loading) return <Loading label="Loading workspace…" />;
  const ws = current.data;
  if (id && !ws) return null;

  return (
    <Box flexDirection="column">
      <Text bold>{ws ? `Edit Workspace ${ws.id}` : 'New Workspace'}</Text>
      <Form
        fields={[
          ...(ws ? [] : [{ name: 'id', label: 'Id', kind: 'text' as const, required: true }]),
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'description', label: 'Description', kind: 'multiline' },
        ]}
        initialValues={ws ? { name: ws.name, description: ws.description } : {}}
        onSubmit={async (values) => {
          const name = String(values.name);
          const description = String(values.description ?? '');
          if (ws) {
            await services.workspaces.update(ws.id, { name, description });
            toast.push('info', `Updated Workspace ${ws.id}`);
          } else {
            const created = await services.workspaces.create({ id: String(values.id), name, description });
            toast.push('info', `Created Workspace ${created.id}`);
          }
          router.pop();
        }}
      />
    </Box>
  );
}
