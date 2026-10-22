import { Box, Text } from 'ink';
import { isSlug, keyPrefixFromName, slugFromName, ValidationError } from '../../../core';
import type { DataRoot } from '../../../schemas';
import { createContext, setGlobalMe } from '../../../services';
import { createDataRoot } from '../../../services/setup';
import { Form, type FormValues } from '../../components';
import { useActivate, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';

const text = (value: FormValues[string] | undefined) => (typeof value === 'string' ? value.trim() : '');

/**
 * The rest of `rowbly init` for `root`: its label, whether it is the default, the first Board and
 * global Me. `stay`: keep the current Data Root and go back, instead of opening the app on the new one.
 */
export function InitForm({ root, cwd, home, stay }: { root: DataRoot; cwd: string; home: string; stay: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const activate = useActivate();
  const warn = (message: string) => toast.push('warning', message);

  return (
    <Box flexDirection="column">
      <Text bold>Create {root.path}</Text>
      <Text color={theme.inkFaint}>
        The label names it in ~/.rowblyrc.json. The default Data Root is opened from every directory.
      </Text>
      <Text color={theme.inkFaint}>Leave the Board name and id empty to skip the first Board.</Text>
      <Text color={theme.inkFaint}>
        Your handle sets global Me (`rowbly whoami`) in ~/.rowblyrc.json, the creator of your Stories in every Data
        Root. Leave it empty to keep the one you have or set it later.
      </Text>
      <Form
        fields={[
          { name: 'label', label: 'Label', kind: 'text' },
          { name: 'default', label: 'Default Data Root', kind: 'boolean' },
          { name: 'boardName', label: 'Board name', kind: 'text' },
          { name: 'boardId', label: 'Board id', kind: 'text', fillFrom: { field: 'boardName', format: slugFromName } },
          {
            name: 'prefix',
            label: 'Key prefix',
            kind: 'text',
            fillFrom: { field: 'boardName', format: keyPrefixFromName },
          },
          { name: 'me', label: 'Your handle (Me)', kind: 'text' },
        ]}
        onSubmit={async (values) => {
          const me = text(values.me) || null;
          // Checked before setup, so a bad handle does not leave a Data Root behind.
          if (me && !isSlug(me)) {
            const message = 'must be a lower-kebab-case slug';
            throw new ValidationError(`me: ${message}`, { details: { issues: [{ path: ['me'], message }] } });
          }
          const boardId = text(values.boardId);
          // The name defaults to the id, and the prefix to the Board id upper-cased.
          const board = boardId
            ? {
                id: boardId,
                name: text(values.boardName) || boardId,
                keyPrefix: text(values.prefix) || boardId.toUpperCase(),
              }
            : undefined;
          await createDataRoot({
            root,
            home,
            board,
            label: text(values.label),
            default: values.default === true,
            warn,
          });
          if (me) await setGlobalMe(home, me);
          const ctx = await createContext({ cwd, env: {}, home, root: root.path, warn });
          toast.push('info', me ? `Created ${root.path}; you are ${me}` : `Created ${root.path}`);
          if (stay) {
            router.pop();
            return;
          }
          activate(ctx);
          router.replace('home');
        }}
      />
    </Box>
  );
}
