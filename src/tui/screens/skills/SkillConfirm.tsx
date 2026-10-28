import { Box, Text } from 'ink';
import { useState } from 'react';
import { deleteSkill, updateSkill } from '../../../services';
import { ConfirmDialog, Modal } from '../../components';
import { useToast } from '../../hooks';
import { theme } from '../../theme';

export function SkillConfirm({
  mode,
  cwd,
  path,
  official,
  onDone,
}: {
  mode: 'update' | 'delete';
  cwd: string;
  path: string;
  official: boolean;
  onDone(): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await (mode === 'delete' ? deleteSkill : updateSkill)({ cwd, path });
      toast.push('info', `${mode === 'delete' ? 'Deleted' : 'Updated'} skill ${path}`);
      onDone();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Settings › Skills › ${mode === 'delete' ? 'Delete' : 'Update'} skill`}
      onClose={busy ? undefined : onDone}
      focused={!busy}
    >
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkFaint}>
          {cwd}/{path}
        </Text>
        <Text color={theme.inkFaint}>
          {mode === 'delete'
            ? 'The whole skill folder and its contents will be deleted.'
            : official
              ? 'Reinstall the bundled version, replacing all installed files.'
              : 'Refresh only references/rowbly-reference.md. Keep SKILL.md and all other files.'}
        </Text>
        {busy ? (
          <Text color={theme.inkFaint}>Working…</Text>
        ) : (
          <ConfirmDialog
            message={`${mode === 'delete' ? 'Delete' : 'Update'} this skill?`}
            destructive={mode === 'delete'}
            confirmLabel={mode === 'delete' ? 'Delete' : 'Update'}
            cancelLabel="Cancel"
            onConfirm={() => void run()}
            onCancel={onDone}
          />
        )}
      </Box>
    </Modal>
  );
}
