import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useContext } from 'react';
import { ConflictError } from '../../../core';
import { assertInitTarget, initTarget, meSource } from '../../../services/setup';
import { Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/**
 * The context switcher: pick a Workspace, then one of its Boards (`params.workspaceId`). The
 * `whoami` view (`params.view`) picks Me from the current Workspace's roster. While `~/.rowbly` does
 * not exist, it also offers to create it, like `init --global`. `params.home` overrides the home
 * directory (for tests).
 */
export function ContextScreen({ params }: ScreenProps) {
  if (params.view === 'whoami') return <WhoamiPicker />;
  if (typeof params.workspaceId === 'string') return <BoardPicker workspaceId={params.workspaceId} />;
  return <WorkspacePicker home={typeof params.home === 'string' ? params.home : homedir()} />;
}

/** The picker entry that opens the global `init` form. */
const CREATE_GLOBAL = '\u0000global';

function WorkspacePicker({ home }: { home: string }) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const workspaces = useAsync(() => services.workspaces.list(), []);
  const globalRoot = initTarget({ cwd: process.cwd(), home, global: true });
  // Rechecked when the screen is back on top, e.g. after the global Data Root was created.
  const canCreateGlobal = useAsync(async () => {
    try {
      await assertInitTarget(globalRoot);
      return true;
    } catch (err) {
      if (err instanceof ConflictError) return false;
      throw err;
    }
  }, [globalRoot.path, active]);
  useKeyHints([
    { key: 'enter', description: 'choose workspace' },
    { key: 'm', description: 'who am I' },
    { key: 'c', description: 'clear context' },
  ]);
  useInput(
    (input) => {
      if (shell.captured().text) return;
      if (input === 'm') router.push('context', { view: 'whoami', title: 'Who am I' });
      else if (input === 'c') {
        services.context.clearUse().then(() => {
          toast.push('info', 'Cleared the current Workspace and Board');
          router.pop();
        }, toast.error);
      }
    },
    { isActive: active },
  );

  if (!workspaces.data) return workspaces.loading ? <Loading label="Loading workspaces…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>Switch Workspace</Text>
      <SelectList
        items={[
          ...workspaces.data.map((ws) => ({
            value: ws.id,
            label: ws.id === ctx?.local.workspace ? `${ws.id} *` : ws.id,
            description: ws.name,
          })),
          ...(canCreateGlobal.data
            ? [{ value: CREATE_GLOBAL, label: 'Create global Data Root', description: globalRoot.path }]
            : []),
        ]}
        emptyText="No Workspaces yet. Create one from Workspaces."
        onSelect={async (item) => {
          if (item.value === CREATE_GLOBAL) {
            router.push('setup', { global: true, home, title: 'Global Data Root' });
            return;
          }
          try {
            if ((await services.boards.list(item.value)).length > 0) {
              router.push('context', { workspaceId: item.value, title: item.value });
              return;
            }
            await services.context.use(item.value);
            toast.push('info', `Now using ${item.value}`);
            router.pop();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </Box>
  );
}

function BoardPicker({ workspaceId }: { workspaceId: string }) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const boards = useAsync(() => services.boards.list(workspaceId), [workspaceId]);
  useKeyHints([{ key: 'enter', description: 'use board' }]);

  if (!boards.data) return boards.loading ? <Loading label="Loading boards…" /> : null;
  const current = (id: string) => ctx?.local.workspace === workspaceId && ctx.local.board === id;
  return (
    <Box flexDirection="column">
      <Text bold>Switch Board in {workspaceId}</Text>
      <SelectList
        items={boards.data.map((b) => ({
          value: b.id,
          label: current(b.id) ? `${b.id} *` : b.id,
          description: `${b.name} (${b.keyPrefix})`,
        }))}
        onSelect={async (item) => {
          try {
            await services.context.use(workspaceId, item.value);
            toast.push('info', `Now using ${workspaceId}/${item.value}`);
            // Back past the Workspace picker too.
            router.pop();
            router.pop();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </Box>
  );
}

const CLEAR = '\u0000clear';

function WhoamiPicker() {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const roster = useAsync(async () => {
    const workspaceId = await services.context.resolveWorkspace();
    return { workspaceId, assignees: await services.assignees.list(workspaceId) };
  }, []);
  useKeyHints([{ key: 'enter', description: 'claim handle' }]);

  const source = ctx ? meSource(ctx) : null;
  const me = ctx?.me ?? null;
  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Me: {me ? <Text bold>{me}</Text> : <Text dimColor>not set</Text>}
        {source && <Text dimColor> ({source === 'local' ? 'from local.json' : 'matched by git email'})</Text>}
      </Text>
      {roster.data ? (
        <Box flexDirection="column">
          <Text bold>Roster of {roster.data.workspaceId}</Text>
          <SelectList
            items={[
              ...roster.data.assignees.map((a) => ({
                value: a.handle,
                label: a.handle === me ? `${a.handle} *` : a.handle,
                description: a.name,
              })),
              ...(me ? [{ value: CLEAR, label: 'Clear Me' }] : []),
            ]}
            emptyText="The roster is empty. Add Assignees from Workspaces."
            onSelect={async (item) => {
              try {
                const handle = item.value === CLEAR ? null : item.value;
                await services.context.setMe(handle);
                toast.push('info', handle ? `You are ${handle}` : 'Cleared Me');
                router.pop();
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        </Box>
      ) : (
        roster.loading && <Loading label="Loading roster…" />
      )}
    </Box>
  );
}
