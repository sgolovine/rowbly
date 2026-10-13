import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { useState } from 'react';
import type { DataRoot } from '../../../schemas';
import { createContext, createServices } from '../../../services';
import { assertInitTarget, initTarget, newContext } from '../../../services/setup';
import { Form, type FormValues, SelectList } from '../../components';
import { useActivate, useKeyHints, useToast } from '../../hooks';
import { useRouter } from '../../router';
import type { ScreenProps } from '../types';

/**
 * First run, when no Data Root exists: pick where to create one, then the same flow as `rowbly init`.
 * `params.cwd` and `params.home` override the process values (for tests).
 */
export function SetupScreen({ params }: ScreenProps) {
  const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd();
  const home = typeof params.home === 'string' ? params.home : homedir();
  const toast = useToast();
  const [root, setRoot] = useState<DataRoot | null>(null);
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
  return <InitForm root={root} cwd={cwd} home={home} />;
}

const text = (value: FormValues[string] | undefined) => (typeof value === 'string' ? value.trim() : '');

function InitForm({ root, cwd, home }: { root: DataRoot; cwd: string; home: string }) {
  const toast = useToast();
  const router = useRouter();
  const activate = useActivate();
  const warn = (message: string) => toast.push('warning', message);

  return (
    <Box flexDirection="column">
      <Text bold>Create {root.path}</Text>
      <Text dimColor>Leave the Workspace id empty to skip the first Workspace and Board.</Text>
      <Form
        fields={[
          { name: 'workspaceId', label: 'Workspace id', kind: 'text' },
          { name: 'workspaceName', label: 'Workspace name', kind: 'text' },
          { name: 'boardId', label: 'Board id', kind: 'text' },
          { name: 'boardName', label: 'Board name', kind: 'text' },
          { name: 'prefix', label: 'Key prefix', kind: 'text' },
        ]}
        onSubmit={async (values) => {
          const wsId = text(values.workspaceId);
          const boardId = text(values.boardId);
          // Names default to the ids, and the prefix to the Board id upper-cased.
          const workspace = wsId ? { id: wsId, name: text(values.workspaceName) || wsId } : undefined;
          const board = boardId
            ? {
                id: boardId,
                name: text(values.boardName) || boardId,
                keyPrefix: text(values.prefix) || boardId.toUpperCase(),
              }
            : undefined;
          await createServices(newContext(root, warn)).setup.init({ root, workspace, board });
          toast.push('info', `Created ${root.path}`);
          activate(await createContext({ cwd, env: {}, home, root: root.path, warn }));
          router.replace('home');
        }}
      />
    </Box>
  );
}
