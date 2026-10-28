import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import { listAllSkills } from '../../../services';
import { Loading, SelectList } from '../../components';
import { useAsync, useEscape, useIsActive, useKeyCapture, useKeyHints } from '../../hooks';
import { theme } from '../../theme';
import { SkillConfirm } from './SkillConfirm';
import { SkillForm } from './SkillForm';

export function SkillsScreen() {
  const [cwd] = useState(() => process.cwd());
  const list = useAsync(() => listAllSkills(cwd), [cwd]);
  const active = useIsActive();
  const [mode, setMode] = useState<'install' | 'create' | 'update' | 'delete' | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [filtering, setFiltering] = useState(false);
  const entries = useMemo(
    () =>
      list.data
        ? [
            ...list.data.official.flatMap((skill) =>
              skill.installed.map((entry) => ({ ...entry, name: skill.name, official: true })),
            ),
            ...list.data.custom.map((skill) => ({ ...skill, official: false })),
          ]
        : [],
    [list.data],
  );
  const items = useMemo(
    () =>
      entries.map((entry) => ({
        value: entry.path,
        label: entry.name,
        description: `${entry.official ? 'official' : 'custom'} · ${entry.harnesses.join('/')} · ${entry.path}`,
      })),
    [entries],
  );
  const skill = entries.find((entry) => entry.path === selected);
  const done = () => {
    setMode(null);
    list.reload();
  };
  useKeyCapture(active && mode !== null, { escape: true });
  useEscape(active && (mode === 'install' || mode === 'create'), done);
  useKeyHints(
    mode
      ? [{ key: 'esc', description: 'cancel' }]
      : filtering
        ? []
        : [
            { key: 'i', description: 'install skill' },
            { key: 'n', description: 'new skill' },
            ...(skill
              ? [
                  { key: 'u', description: 'update' },
                  { key: 'd', description: 'delete' },
                ]
              : []),
            { key: '↑/↓', description: 'select' },
            { key: '/', description: 'filter' },
          ],
  );
  useInput(
    (input) => {
      if (input === 'i') setMode('install');
      else if (input === 'n') setMode('create');
      else if (skill && input === 'u') setMode('update');
      else if (skill && input === 'd') setMode('delete');
    },
    { isActive: active && mode === null && !filtering },
  );
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={theme.inkFaint}>Managed folder: {cwd}</Text>
      <Text color={theme.inkFaint}>Skills use this folder's harness directories, independently of the Data Root.</Text>
      {list.data ? (
        <>
          <Text color={theme.inkFaint}>Bundled: {list.data.official.map((s) => s.name).join(', ')}</Text>
          <SelectList
            items={items}
            isActive={mode === null}
            onHighlight={(item) => setSelected(item?.value)}
            onSelect={(item) => setSelected(item.value)}
            onFilteringChange={setFiltering}
            emptyText="No installed Rowbly skills. i installs one; n creates one."
          />
        </>
      ) : list.loading ? (
        <Loading label="Loading skills…" />
      ) : (
        <Text color={theme.inkFaint}>Could not load skills.</Text>
      )}
      {(mode === 'install' || mode === 'create') && <SkillForm mode={mode} cwd={cwd} onDone={done} />}
      {(mode === 'update' || mode === 'delete') && skill && (
        <SkillConfirm mode={mode} cwd={cwd} path={skill.path} official={skill.official} onDone={done} />
      )}
    </Box>
  );
}
