import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { progressText } from './ProgressBar';

type Shown = 'open' | 'all' | 'closed';
const NEXT: Record<Shown, Shown> = { open: 'all', all: 'closed', closed: 'open' };
const CLOSED_OPTION = { open: false, all: 'all', closed: true } as const;
const TITLE = { open: 'Open Epics', all: 'All Epics', closed: 'Closed Epics' };
const EMPTY = { open: 'No open Epics.', all: 'No Epics yet.', closed: 'No closed Epics.' };

/** Epics with their progress bars; `a` cycles open → all → closed, like `epics list [--all|--closed]`. */
export function EpicList() {
  const services = useServices();
  const router = useRouter();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [shown, setShown] = useState<Shown>('open');
  // Reloads when the screen is back on top, so edits made deeper in the stack show up.
  const epics = useAsync(() => services.epics.list({ closed: CLOSED_OPTION[shown] }), [services, shown, active]);

  useKeyHints([
    { key: 'enter', description: 'open' },
    { key: 'n', description: 'new' },
    { key: 'a', description: `show ${NEXT[shown]}` },
  ]);
  useInput(
    (input) => {
      if (shell.captured().text) return;
      if (input === 'n') router.push('epics', { view: 'form', title: 'New Epic' });
      else if (input === 'a') setShown((s) => NEXT[s]);
    },
    { isActive: active },
  );

  if (!epics.data) return epics.loading ? <Loading label="Loading Epics…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>{TITLE[shown]}</Text>
      <SelectList
        items={epics.data.map((epic) => ({
          value: epic.id,
          label: epic.name,
          description: `${progressText(epic.progress)} · ${epic.id}${epic.closed ? ' · closed' : ''}`,
        }))}
        emptyText={`${EMPTY[shown]} Press n to create one.`}
        onSelect={(item) => router.push('epics', { view: 'detail', id: item.value, title: item.label })}
      />
    </Box>
  );
}
