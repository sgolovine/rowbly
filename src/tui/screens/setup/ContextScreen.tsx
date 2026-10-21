import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useContext } from 'react';
import { ConflictError } from '../../../core';
import { assertInitTarget, initTarget } from '../../../services/setup';
import { Form, Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';

/**
 * The context switcher: pick the Board in context. The `whoami` view (`params.view`) sets Me. While
 * `~/.rowbly` does not exist, it also offers to create it, like `init --global`. `params.home`
 * overrides the home directory (for tests).
 */
export function ContextScreen({ params }: ScreenProps) {
  if (params.view === 'whoami') return <WhoamiPicker />;
  return <BoardPicker home={typeof params.home === 'string' ? params.home : homedir()} />;
}

/** The picker entry that opens the global `init` form. */
const CREATE_GLOBAL = '\u0000global';

function BoardPicker({ home }: { home: string }) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const boards = useAsync(() => services.boards.list(), []);
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
    { key: 'enter', description: 'use board' },
    { key: 'm', description: 'who am I' },
    { key: 'c', description: 'clear context' },
  ]);
  useInput(
    (input) => {
      if (shell.captured().text) return;
      if (input === 'm') router.push('context', { view: 'whoami', title: 'Who am I' });
      else if (input === 'c') {
        services.context.clearUse().then(() => {
          toast.push('info', 'Cleared the current Board');
          router.pop();
        }, toast.error);
      }
    },
    { isActive: active },
  );

  if (!boards.data) return boards.loading ? <Loading label="Loading boards…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>Switch Board</Text>
      <SelectList
        items={[
          ...boards.data.map((b) => ({
            value: b.id,
            label: b.id === ctx?.local.board ? `${b.id} *` : b.id,
            description: `${b.name} (${b.keyPrefix})`,
          })),
          ...(canCreateGlobal.data
            ? [{ value: CREATE_GLOBAL, label: 'Create global Data Root', description: globalRoot.path }]
            : []),
        ]}
        emptyText="No Boards yet. Create one from Boards."
        onSelect={async (item) => {
          if (item.value === CREATE_GLOBAL) {
            router.push('setup', { global: true, home, title: 'Global Data Root' });
            return;
          }
          try {
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

/** Claims Me: a handle, or nothing to clear it. */
function WhoamiPicker() {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const toast = useToast();
  const me = ctx?.me ?? null;
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Me: {me ? <Text bold>{me}</Text> : <Text color={theme.inkFaint}>not set</Text>}</Text>
      <Form
        fields={[{ name: 'handle', label: 'Handle (empty clears Me)', kind: 'text' }]}
        initialValues={{ handle: me ?? '' }}
        onSubmit={async (values) => {
          const handle = String(values.handle ?? '').trim() || null;
          await services.context.setMe(handle);
          toast.push('info', handle ? `You are ${handle}` : 'Cleared Me');
          router.pop();
        }}
      />
    </Box>
  );
}
