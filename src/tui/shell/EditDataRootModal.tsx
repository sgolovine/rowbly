import { Box, Text } from 'ink';
import { type KnownDataRootChoice, updateKnownDataRoot } from '../../services';
import { Form, Modal } from '../components';
import { useEscape, useKeyCapture, useToast } from '../hooks';
import { theme } from '../theme';
import { dataRootName, tildePath } from './dataRootName';

/**
 * Edits a known Data Root's entry in the Home Config: its label and whether it is the default. An
 * empty label removes it; making one the default clears the default on the others.
 */
export function EditDataRootModal({
  root,
  home,
  onDone,
  onCancel,
}: {
  root: KnownDataRootChoice;
  home: string;
  onDone(): void;
  onCancel(): void;
}) {
  const toast = useToast();
  useKeyCapture(true, { escape: true });
  useEscape(true, onCancel);
  return (
    <Modal title={`Edit ${dataRootName(root)}`} onClose={onCancel}>
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkFaint}>{tildePath(root.path, home)}</Text>
        <Form
          fields={[
            { name: 'label', label: 'Label', kind: 'text' },
            { name: 'default', label: 'Default Data Root', kind: 'boolean' },
          ]}
          initialValues={{ label: root.label ?? '', default: root.default === true }}
          onSubmit={async (values) => {
            await updateKnownDataRoot(home, root.path, {
              label: String(values.label ?? ''),
              default: values.default === true,
            });
            toast.push('info', `Updated ${dataRootName({ ...root, label: String(values.label ?? '').trim() })}`);
            onDone();
          }}
        />
      </Box>
    </Modal>
  );
}
