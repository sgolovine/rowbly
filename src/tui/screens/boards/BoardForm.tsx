import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { keyPrefixFromName, slugFromName } from '../../../core';
import type { DataRoot } from '../../../schemas';
import { createContext, createServices, type Services } from '../../../services';
import { initTarget, newContext } from '../../../services/setup';
import { pathExists } from '../../../storage';
import { Form } from '../../components';
import { useActivate, useBoardSelection, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';

/** Creates the Board in `services`' Data Root, its id and key prefix inferred from its name. */
async function createBoard(services: Services, name: string, description: string) {
  const boards = await services.boards.list();
  return services.boards.create({
    id: slugFromName(name, new Set(boards.map((b) => b.id))),
    name,
    keyPrefix: keyPrefixFromName(name, new Set(boards.map((b) => b.keyPrefix))),
    description,
  });
}

/**
 * Creates a Board, then switches to it. Opened from the sidebar's New Board button. It asks which Data Root
 * the Board goes in: the one here (the one in use when it is not global, else `<cwd>/.rowbly`) or the
 * global one (`~/.rowbly`). A Data Root that does not exist yet is created first, like `init`, and
 * the app switches to the chosen Data Root. The Board's id and key prefix are inferred from its name,
 * numbered when another Board already uses them. `params.cwd` and `params.home` override the process
 * values (for tests).
 */
export function BoardFormScreen({ params }: ScreenProps) {
  const cwd = typeof params.cwd === 'string' ? params.cwd : process.cwd();
  const home = typeof params.home === 'string' ? params.home : homedir();
  const services = useServices();
  const ctx = useRowblyContext();
  const selection = useBoardSelection();
  const activate = useActivate();
  const toast = useToast();
  const router = useRouter();
  const current = ctx?.root ?? null;
  const roots: Record<DataRoot['kind'], DataRoot> = {
    local: current?.kind === 'local' ? current : initTarget({ cwd, home, global: false }),
    global: initTarget({ cwd, home, global: true }),
  };
  const warn = (message: string) => toast.push('warning', message);

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={theme.inkFaint}>
        A Board holds Stories; its key prefix, taken from the name, starts every Story Key (e.g. WEB-42).
      </Text>
      <Form
        fields={[
          {
            name: 'root',
            label: 'Data Root',
            kind: 'select',
            required: true,
            options: ['local', 'global'],
            optionLabels: { local: `Here (${roots.local.path})`, global: `Global (${roots.global.path})` },
          },
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'description', label: 'Description', kind: 'text' },
        ]}
        initialValues={{ root: current?.kind === 'global' ? 'global' : 'local' }}
        onSubmit={async (values) => {
          const name = String(values.name);
          const description = String(values.description ?? '');
          const root = roots[values.root === 'global' ? 'global' : 'local'];
          if (root.path === current?.path) {
            const board = await createBoard(services, name, description);
            toast.push('info', `Created ${board.name} (${board.keyPrefix})`);
            router.pop();
            await selection.select(board.id);
            return;
          }
          if (!(await pathExists(root.path))) {
            await createServices(newContext(root, warn)).setup.init({ root, board: undefined });
            toast.push('info', `Created ${root.path}`);
          }
          // Switch first, so the Board is created with the Plugins that Data Root has on.
          const next = await activate(await createContext({ cwd, env: {}, home, root: root.path, warn }));
          const board = await createBoard(next, name, description);
          await next.context.use(board.id);
          toast.push('info', `Created ${board.name} (${board.keyPrefix}) in ${root.path}`);
          router.reset('board');
        }}
      />
    </Box>
  );
}
