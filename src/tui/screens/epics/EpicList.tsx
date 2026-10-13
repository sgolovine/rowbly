import { Box, Text, useInput } from 'ink';
import { useContext, useState } from 'react';
import { Loading, SelectList } from '../../components';
import { ShellContext, useAsync, useIsActive, useKeyHints, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { progressText } from './ProgressBar';

/** Open Epics with their progress bars; `a` also shows closed ones. */
export function EpicList() {
  const services = useServices();
  const router = useRouter();
  const shell = useContext(ShellContext);
  const active = useIsActive();
  const [showClosed, setShowClosed] = useState(false);
  // Reloads when the screen is back on top, so edits made deeper in the stack show up.
  const epics = useAsync(async () => {
    const ws = await services.context.resolveWorkspace();
    return services.epics.list(ws, { closed: showClosed ? 'all' : false });
  }, [services, showClosed, active]);

  useKeyHints([
    { key: 'enter', description: 'open' },
    { key: 'n', description: 'new' },
    { key: 'a', description: showClosed ? 'hide closed' : 'show closed' },
  ]);
  useInput(
    (input) => {
      if (shell.captured().text) return;
      if (input === 'n') router.push('epics', { view: 'form', title: 'New Epic' });
      else if (input === 'a') setShowClosed((s) => !s);
    },
    { isActive: active },
  );

  if (!epics.data) return epics.loading ? <Loading label="Loading Epics…" /> : null;
  return (
    <Box flexDirection="column">
      <Text bold>{showClosed ? 'All Epics' : 'Open Epics'}</Text>
      <SelectList
        items={epics.data.map((epic) => ({
          value: epic.id,
          label: epic.name,
          description: `${progressText(epic.progress)} · ${epic.id}${epic.closed ? ' · closed' : ''}`,
        }))}
        emptyText={showClosed ? 'No Epics yet. Press n to create one.' : 'No open Epics. Press n to create one.'}
        onSelect={(item) => router.push('epics', { view: 'detail', id: item.value, title: item.label })}
      />
    </Box>
  );
}
