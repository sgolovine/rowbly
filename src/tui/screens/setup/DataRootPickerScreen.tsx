import { homedir } from 'node:os';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { DataRootNotFoundError } from '../../../core';
import { type KnownDataRootChoice, knownDataRoots, missingLast, openKnownDataRoot } from '../../../services';
import { Loading, MissingDataRootModal, SelectList, SelectListRow } from '../../components';
import { useActivate, useAsync, useIsActive, useKeyHints, useToast } from '../../hooks';
import { globalAction } from '../../keymap';
import { useRouter } from '../../router';
import { DataRootList, dataRootSearchHints } from '../../shell';
import { theme } from '../../theme';

/**
 * Startup outside a local Data Root asks which known Data Root to open, before onboarding.
 * **+ New Data Root** is pinned above them. Missing ones are listed last; picking one says it no longer
 * exists and offers to delete it from the list.
 */
export function DataRootPickerScreen() {
  const home = homedir();
  const roots = useAsync(() => knownDataRoots(home, null), [home]);
  const activate = useActivate();
  const router = useRouter();
  const toast = useToast();
  const active = useIsActive();
  const [opening, setOpening] = useState(false);
  // `null` while the search is not focused.
  const [query, setQuery] = useState<string | null>(null);
  const [missing, setMissing] = useState<KnownDataRootChoice | null>(null);
  const picking = active && !opening && !missing && roots.data !== undefined;
  const create = () => router.push('setup', { title: 'New Data Root' });
  useKeyHints(
    picking
      ? [...dataRootSearchHints(query), ...(query === null ? [{ key: 'n', description: 'new Data Root' }] : [])]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') create();
    },
    { isActive: picking && query === null },
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
      <DataRootList
        roots={choices}
        home={home}
        active={picking}
        query={query}
        onQueryChange={setQuery}
        // `n` and the shell's keys, such as `q` to quit, keep their meaning.
        actionKey={(input, key) => input === 'n' || globalAction(input, key) !== null}
        limit={10}
        renderRow={(root, highlighted, onClick) => (
          <SelectListRow highlighted={highlighted} active={picking} onClick={onClick}>
            {root.label || root.path}
            {root.default ? ' · default' : ''}
            {root.missing ? ' · missing' : ''}
            {root.label && <Text color={theme.inkFaint}> {root.path}</Text>}
          </SelectListRow>
        )}
        newRow={(highlighted, onClick) => (
          <SelectListRow highlighted={highlighted} active={picking} onClick={onClick}>
            + New Data Root{' '}
            <Text backgroundColor={theme.keycap} color={theme.inkMuted} bold={false}>
              {' n '}
            </Text>
          </SelectListRow>
        )}
        onPick={async (root) => {
          if (root === null) return create();
          if (root.missing) return setMissing(root);
          setOpening(true);
          try {
            await activate(
              await openKnownDataRoot({
                path: root.path,
                home,
                cwd: process.cwd(),
                warn: (message) => toast.push('warning', message),
              }),
            );
          } catch (err) {
            // Gone since the list was read.
            if (err instanceof DataRootNotFoundError) setMissing({ ...root, missing: true });
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
