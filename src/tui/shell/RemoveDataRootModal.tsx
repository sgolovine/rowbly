import { Box, Text } from 'ink';
import { useState } from 'react';
import { type KnownDataRootChoice, removeKnownDataRoot } from '../../services';
import { ConfirmDialog, Loading, Modal, SelectList } from '../components';
import { useEscape, useKeyCapture, useToast } from '../hooks';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';
import { dataRootName, tildePath } from './dataRootName';

type Choice = 'forget' | 'delete';

const HINTS: readonly KeyHint[] = [
  { key: '↑/↓', description: 'select' },
  { key: 'enter', description: 'choose' },
  { key: 'esc', description: 'cancel' },
];

/**
 * Removes a known Data Root, asking how: forget it (its entry in the Home Config goes, its folder
 * stays) or delete its folder as well, which asks once more. A missing one can only be forgotten.
 */
export function RemoveDataRootModal({
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
  const name = dataRootName(root);
  const path = tildePath(root.path, home);
  const [choice, setChoice] = useState<Choice | null>(root.missing ? 'forget' : null);
  const [busy, setBusy] = useState(false);
  const choosing = choice === null && !busy;
  useKeyCapture(choosing, { escape: true });
  useEscape(choosing, onCancel);

  const remove = async (deleteFolder: boolean) => {
    setBusy(true);
    try {
      await removeKnownDataRoot(home, root, { deleteFolder });
      toast.push('info', deleteFolder ? `Deleted ${name}` : `Forgot ${name}`);
      onDone();
    } catch (err) {
      toast.error(err);
      onCancel();
    }
  };

  return (
    <Modal title={`Remove ${name}`} size="dialog" hints={choosing ? HINTS : []} onClose={busy ? undefined : onCancel}>
      {busy ? (
        <Loading label={`Removing ${name}…`} />
      ) : choice === null ? (
        <Box flexDirection="column" gap={1}>
          <Text color={theme.inkFaint}>{path}</Text>
          <SelectList<Choice>
            items={[
              { value: 'forget', label: 'Forget it', description: 'remove it from the list, keep its folder' },
              { value: 'delete', label: 'Delete it', description: 'delete its folder and every Board in it' },
            ]}
            onSelect={(item) => (item.value === 'forget' ? void remove(false) : setChoice('delete'))}
          />
        </Box>
      ) : choice === 'forget' ? (
        <ConfirmDialog
          message={`Forget ${name}? Its folder ${path} is already gone.`}
          confirmLabel="Forget"
          cancelLabel="Cancel"
          onConfirm={() => void remove(false)}
          onCancel={onCancel}
        />
      ) : (
        <ConfirmDialog
          message={`Delete ${path} with every Board, Story and Plugin file in it? This cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove(true)}
          onCancel={() => setChoice(null)}
        />
      )}
    </Modal>
  );
}
