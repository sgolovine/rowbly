import { Box, Text } from 'ink';
import { useState } from 'react';
import { HARNESS_FOLDERS, HARNESSES, type Harness, installSkill, officialSkills } from '../../../services';
import { Form, Loading, SelectList } from '../../components';
import { useAsync, useEscape, useIsActive, useKeyCapture, useKeyHints, useToast } from '../../hooks';
import { theme } from '../../theme';

/** One explicit install at a time, using the CLI service's no-overwrite behavior. */
export function SkillInstall({ onDone }: { onDone(): void }) {
  const skills = useAsync(officialSkills, []);
  const toast = useToast();
  const [skill, setSkill] = useState<{ name: string; dir: string } | null>(null);
  const active = useIsActive();
  useKeyHints(
    skill
      ? [{ key: 'esc', description: 'back to skills' }]
      : [
          { key: '↑/↓', description: 'select skill' },
          { key: 'enter', description: 'choose' },
        ],
  );
  useKeyCapture(active && skill !== null, { text: false, escape: true });
  useEscape(active && skill !== null, () => setSkill(null));
  if (!skills.data)
    return skills.loading ? (
      <Loading label="Reading official skills…" />
    ) : (
      <SelectList items={[{ value: 'retry', label: 'Retry reading skills' }]} onSelect={skills.reload} />
    );
  const availableSkills = skills.data;
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Agent skills</Text>
      <Text color={theme.inkMuted}>
        rowbly teaches an agent the CLI; rowbly-dev develops a Story; rowbly-grill refines its Spec; rowbly-factory
        supervises a Board.
      </Text>
      <Text color={theme.inkMuted}>
        For your own workflow, run rowbly skills create &lt;name&gt; --harness &lt;harness&gt; in its folder, then edit
        SKILL.md. Install a custom skill with rowbly skills install &lt;folder&gt;.
      </Text>
      {skill ? (
        <>
          <Text>
            Install {skill.name}. The selected harness’s skills folder is created below the folder you choose. Existing
            skills are never overwritten.
          </Text>
          <Form
            fields={[
              { name: 'cwd', label: 'Folder for skills', kind: 'text', required: true },
              {
                name: 'harness',
                label: 'Harness',
                kind: 'select',
                required: true,
                options: HARNESSES,
                optionLabels: Object.fromEntries(HARNESSES.map((h) => [h, `${h} (${HARNESS_FOLDERS[h]})`])),
              },
            ]}
            initialValues={{ cwd: process.cwd(), harness: 'codex' }}
            submitLabel="install"
            onSubmit={async (values) => {
              const result = await installSkill({
                cwd: String(values.cwd),
                source: skill.dir,
                harness: values.harness as Harness,
              });
              toast.push('info', `Installed ${result.name} at ${result.path}`);
              setSkill(null);
            }}
          />
          <Text color={theme.inkFaint}>esc returns to onboarding; ctrl+k skips onboarding.</Text>
        </>
      ) : (
        <SelectList
          items={[
            ...availableSkills.map((skill) => ({ value: skill.dir, label: `Install ${skill.name}` })),
            { value: '', label: 'Continue without installing more skills' },
          ]}
          onSelect={(item) =>
            item.value ? setSkill(availableSkills.find((skill) => skill.dir === item.value) ?? null) : onDone()
          }
        />
      )}
    </Box>
  );
}
