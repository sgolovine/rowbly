import { Box, Text } from 'ink';
import { createSkill, HARNESS_FOLDERS, HARNESSES, type Harness, installSkill } from '../../../services';
import { Form, Modal } from '../../components';
import { useToast } from '../../hooks';
import { theme } from '../../theme';

export function SkillForm({ mode, cwd, onDone }: { mode: 'install' | 'create'; cwd: string; onDone(): void }) {
  const toast = useToast();
  return (
    <Modal title={`Settings › Skills › ${mode === 'install' ? 'Install skill' : 'New skill'}`} onClose={onDone}>
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkFaint}>Folder: {cwd}</Text>
        {mode === 'install' && (
          <Text color={theme.inkFaint}>Use a bundled skill name or a local folder holding SKILL.md.</Text>
        )}
        <Form
          fields={[
            { name: 'name', label: mode === 'install' ? 'Name or folder' : 'Name', kind: 'text', required: true },
            ...(mode === 'create' ? [{ name: 'description', label: 'Description', kind: 'text' as const }] : []),
            {
              name: 'harness',
              label: 'Harness',
              kind: 'select',
              options: HARNESSES,
              optionLabels: Object.fromEntries(HARNESSES.map((h) => [h, `${h} · ${HARNESS_FOLDERS[h]}`])),
              required: true,
            },
          ]}
          initialValues={{ harness: 'generic' }}
          submitLabel={mode === 'install' ? 'install' : 'create'}
          onSubmit={async (values) => {
            const harness = values.harness as Harness;
            const name = String(values.name).trim();
            const skill =
              mode === 'install'
                ? await installSkill({ cwd, source: name, harness })
                : await createSkill({ cwd, name, harness, description: String(values.description ?? '') });
            toast.push('info', `${mode === 'install' ? 'Installed' : 'Created'} skill ${skill.name}`);
            onDone();
          }}
        />
      </Box>
    </Modal>
  );
}
