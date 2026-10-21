import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { useState } from 'react';
import type { DataRoot } from '../../../schemas';
import { createContext, createServices } from '../../../services';
import { assertInitTarget, initTarget, newContext } from '../../../services/setup';
import { Form, type FormValues, SelectList } from '../../components';
import { useActivate, useKeyHints, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';

/**
 * First run, when no Data Root exists: pick where to create one, then the same flow as `rowbly init`.
 * With `params.global` (from the Context screen) it goes straight to the form for `~/.rowbly`, like
 * `init --global`, and returns afterwards without leaving the current Data Root.
 * `params.cwd` and `params.home` override the process values (for tests).
 */
export function SetupScreen({ params }: ScreenProps) {
  const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd();
  const home = typeof params.home === 'string' ? params.home : homedir();
  const toast = useToast();
  const [root, setRoot] = useState<DataRoot | null>(() =>
    params.global === true ? initTarget({ cwd, home, global: true }) : null,
  );
  useKeyHints([{ key: 'enter', description: root ? 'create' : 'choose' }]);

  if (!root) {
    const local = initTarget({ cwd, home, global: false });
    const global = initTarget({ cwd, home, global: true });
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Welcome to Rowbly</Text>
        <Text>No Data Root found. Where should Rowbly keep its data?</Text>
        <SelectList
          items={[
            { value: 'local', label: 'Here', description: local.path },
            { value: 'global', label: 'Globally', description: global.path },
          ]}
          onSelect={async (item) => {
            const target = item.value === 'global' ? global : local;
            try {
              // Refuse an existing Data Root before showing the form.
              await assertInitTarget(target);
              setRoot(target);
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      </Box>
    );
  }
  return <InitForm root={root} cwd={cwd} home={home} stay={params.global === true} />;
}

const text = (value: FormValues[string] | undefined) => (typeof value === 'string' ? value.trim() : '');

/** `stay`: keep the current Data Root and go back, instead of opening the app on the new one. */
function InitForm({ root, cwd, home, stay }: { root: DataRoot; cwd: string; home: string; stay: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const activate = useActivate();
  const warn = (message: string) => toast.push('warning', message);

  return (
    <Box flexDirection="column">
      <Text bold>Create {root.path}</Text>
      <Text color={theme.inkFaint}>Leave the Board id empty to skip the first Board.</Text>
      <Form
        fields={[
          { name: 'boardId', label: 'Board id', kind: 'text' },
          { name: 'boardName', label: 'Board name', kind: 'text' },
          { name: 'prefix', label: 'Key prefix', kind: 'text' },
        ]}
        onSubmit={async (values) => {
          const boardId = text(values.boardId);
          // The name defaults to the id, and the prefix to the Board id upper-cased.
          const board = boardId
            ? {
                id: boardId,
                name: text(values.boardName) || boardId,
                keyPrefix: text(values.prefix) || boardId.toUpperCase(),
              }
            : undefined;
          await createServices(newContext(root, warn)).setup.init({ root, board });
          toast.push('info', `Created ${root.path}`);
          if (stay) {
            router.pop();
            return;
          }
          activate(await createContext({ cwd, env: {}, home, root: root.path, warn }));
          router.replace('home');
        }}
      />
    </Box>
  );
}
