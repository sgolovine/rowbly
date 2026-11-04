import { isAbsolute, join, relative } from 'node:path';
import { Box, Text } from 'ink';
import { useState } from 'react';
import {
  HARNESS_FOLDERS,
  HARNESSES,
  type Harness,
  installSkill,
  listAllSkills,
  officialSkills,
} from '../../../services';
import { Form, Loading, SelectList } from '../../components';
import { useAsync, useEscape, useIsActive, useKeyCapture, useKeyHints, useToast } from '../../hooks';
import { theme } from '../../theme';

const NO_INSTALLS: { name: string; path: string }[] = [];

/** Shows an installed skill folder relative to the current folder when it is below it. */
function shownPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

/**
 * One explicit install at a time, using the CLI service's no-overwrite behavior. A skill is marked
 * installed when it is below the current folder (as the CLI picker reads it) or was installed here.
 */
export function SkillInstall({
  onDone,
  onInstalled,
  installedThisVisit = NO_INSTALLS,
}: {
  installedThisVisit?: { name: string; path: string }[];
  onDone(): void;
  onInstalled?(skill: { name: string; path: string }): Promise<void>;
}) {
  const [installedHere, setInstalledHere] = useState<{ name: string; path: string }[]>([]);
  const skills = useAsync(async () => {
    const [available, list] = await Promise.all([officialSkills(), listAllSkills(process.cwd())]);
    return available.map((skill) => {
      const found = list.official.find((entry) => entry.name === skill.name)?.installed ?? [];
      const paths = [
        ...found.map((at) => join(process.cwd(), at.path)),
        ...installedThisVisit.filter((at) => at.name === skill.name).map((at) => at.path),
        ...installedHere.filter((at) => at.name === skill.name).map((at) => at.path),
      ];
      return { ...skill, installedAt: [...new Set(paths)].map(shownPath) };
    });
  }, [installedHere, installedThisVisit]);
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
              setInstalledHere((prev) => [...prev, { name: result.name, path: join(String(values.cwd), result.path) }]);
              await onInstalled?.({ name: result.name, path: join(String(values.cwd), result.path) });
              setSkill(null);
            }}
          />
          <Text color={theme.inkFaint}>esc returns to onboarding; ctrl+k skips onboarding.</Text>
        </>
      ) : (
        <SelectList
          items={[
            ...availableSkills.map((skill) =>
              skill.installedAt.length > 0
                ? {
                    value: skill.dir,
                    label: `Install ${skill.name} (installed)`,
                    description: skill.installedAt.join(', '),
                  }
                : { value: skill.dir, label: `Install ${skill.name}` },
            ),
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
