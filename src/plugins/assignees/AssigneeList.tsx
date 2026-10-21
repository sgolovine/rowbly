import type { PluginScreenProps } from '../../plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  theme,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
} from '../../plugin-api/tui';
import { listAssignees } from './roster';

/** The Assignee roster; Me is marked. */
export function AssigneeList({ plugin, ui }: PluginScreenProps<Record<string, unknown>>) {
  const active = useIsActive();
  const roster = useAsync(() => listAssignees(plugin), [plugin]);
  // Back from an Assignee or its form shows what changed there.
  useReloadOnReturn(roster.reload);
  useKeyHints([
    { key: 'enter', description: 'open' },
    { key: 'n', description: 'add assignee' },
  ]);
  useInput(
    (input) => {
      if (input === 'n') ui.open('form', { title: 'New Assignee' });
    },
    { isActive: active },
  );

  if (!roster.data)
    return roster.loading ? (
      <Loading label="Loading assignees…" />
    ) : (
      <Text color={theme.danger}>Could not load Assignees.</Text>
    );
  return (
    <Box flexDirection="column">
      <Text bold>Assignees</Text>
      <SelectList
        items={roster.data.map((a) => ({
          value: a.handle,
          label: a.handle === plugin.me ? `${a.handle} (me)` : a.handle,
          description: a.email ? `${a.name} <${a.email}>` : a.name,
        }))}
        emptyText="No Assignees yet. Press n to add one."
        onSelect={(item) => ui.open('detail', { handle: item.value, title: item.value })}
      />
    </Box>
  );
}
