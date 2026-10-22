import { Box, Text } from 'ink';
import { ConflictError, ValidationError } from '../../../core';
import type { DataRoot } from '../../../schemas';
import { assertInitTarget, setupTarget } from '../../../services/setup';
import { Form } from '../../components';
import { theme } from '../../theme';

/** The path of a Data Root in another folder; `onChoose` gets it once it is checked to be free. */
export function CustomPathForm({ cwd, home, onChoose }: { cwd: string; home: string; onChoose(root: DataRoot): void }) {
  return (
    <Box flexDirection="column">
      <Text bold>Data Root in another folder</Text>
      <Text color={theme.inkFaint}>
        The path of the Data Root folder itself, e.g. ~/work/.rowbly. A relative path starts at {cwd}.
      </Text>
      <Form
        submitLabel="next"
        fields={[{ name: 'path', label: 'Folder', kind: 'text', required: true }]}
        onSubmit={async (values) => {
          const root = setupTarget('custom', { cwd, home, path: String(values.path ?? '') });
          try {
            await assertInitTarget(root);
          } catch (err) {
            if (!(err instanceof ConflictError)) throw err;
            const message = `${root.path} already exists`;
            throw new ValidationError(message, { details: { issues: [{ path: ['path'], message }] } });
          }
          onChoose(root);
        }}
      />
    </Box>
  );
}
