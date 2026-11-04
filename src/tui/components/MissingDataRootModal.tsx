import { Box, Text } from 'ink';
import { useState } from 'react';
import { type KnownDataRootChoice, removeKnownDataRoot } from '../../services';
import { useToast } from '../hooks';
import { theme } from '../theme';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { Loading } from './Spinner';

/**
 * Picking a known Data Root whose folder is gone says so and asks to delete it from the list: its
 * entry in the Home Config goes, as **Forget it** does. `name` and `path` are as the list shows them.
 */
export function MissingDataRootModal({
  root,
  name,
  path,
  home,
  onDone,
  onCancel,
}: {
  root: KnownDataRootChoice;
  name: string;
  path: string;
  home: string;
  onDone(): void;
  onCancel(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await removeKnownDataRoot(home, root, { deleteFolder: false });
      toast.push('info', `Deleted ${name} from the list`);
      onDone();
    } catch (err) {
      toast.error(err);
      onCancel();
    }
  };

  return (
    <Modal title={name} size="dialog" onClose={busy ? undefined : onCancel}>
      {busy ? (
        <Loading label={`Removing ${name}…`} />
      ) : (
        <Box flexDirection="column" gap={1}>
          <Text color={theme.inkFaint}>{path}</Text>
          <ConfirmDialog
            message="This Data Root no longer exists. Delete it from the list of Data Roots?"
            confirmLabel="Delete"
            cancelLabel="Keep it"
            destructive
            onConfirm={() => void remove()}
            onCancel={onCancel}
          />
        </Box>
      )}
    </Modal>
  );
}
