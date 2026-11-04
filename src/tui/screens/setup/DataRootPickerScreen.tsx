import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { DataRootNotFoundError } from '../../../core';
import { type KnownDataRootChoice, knownDataRoots, missingLast, openKnownDataRoot } from '../../../services';
import { Loading, MissingDataRootModal, SelectList } from '../../components';
import { useActivate, useAsync, useIsActive, useKeyHints, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';

/**
 * Startup outside a local Data Root asks which known Data Root to open, before onboarding. Missing ones
 * are listed last; picking one says it no longer exists and offers to delete it from the list.
 */
export function DataRootPickerScreen() {
  const home = homedir();
  const roots = useAsync(() => knownDataRoots(home, null), [home]);
  const activate = useActivate();
  const router = useRouter();
  const toast = useToast();
  const active = useIsActive();
  const [opening, setOpening] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [missing, setMissing] = useState<KnownDataRootChoice | null>(null);
  const picking = active && !opening && !missing && roots.data !== undefined;
  const create = () => router.push('setup', { title: 'New Data Root' });
  useKeyHints(
    picking
      ? [
          { key: '↑/↓', description: 'select' },
          { key: 'enter', description: 'open' },
          { key: 'n', description: 'new Data Root' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') create();
    },
    { isActive: picking && !filtering },
  );

  if (!roots.data)
    return roots.loading ? (
      <Loading />
    ) : (
      <SelectList items={[{ value: 'retry', label: 'Retry reading Data Roots' }]} onSelect={roots.reload} />
    );
  const choices = missingLast([...roots.data].sort((a, b) => Number(!!b.default) - Number(!!a.default)));
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Choose a Data Root</Text>
      <Text color={theme.inkMuted}>No Data Root found in this directory. Open one below or create a new one.</Text>
      <SelectList
        isActive={!opening && !missing}
        onFilteringChange={setFiltering}
        items={[
          ...choices.map((root) => ({
            value: root.path,
            label: `${root.label || root.path}${root.default ? ' · default' : ''}${root.missing ? ' · missing' : ''}`,
            description: root.label ? root.path : undefined,
          })),
          { value: null, label: '+ New Data Root' },
        ]}
        onSelect={async ({ value }) => {
          if (value === null) return create();
          const root = choices.find((choice) => choice.path === value);
          if (root?.missing) return setMissing(root);
          setOpening(true);
          try {
            await activate(
              await openKnownDataRoot({
                path: value,
                home,
                cwd: process.cwd(),
                warn: (message) => toast.push('warning', message),
              }),
            );
          } catch (err) {
            // Gone since the list was read.
            if (root && err instanceof DataRootNotFoundError) setMissing({ ...root, missing: true });
            else toast.error(err);
          } finally {
            setOpening(false);
          }
        }}
      />
      {opening && <Loading label="Opening Data Root…" />}
      {missing && (
        <MissingDataRootModal
          root={missing}
          name={missing.label || missing.path}
          path={missing.path}
          home={home}
          onDone={() => {
            setMissing(null);
            roots.reload();
          }}
          onCancel={() => setMissing(null)}
        />
      )}
    </Box>
  );
}
