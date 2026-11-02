import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import {
  readOpenStoryAfterCreation,
  readStoryFinderAllBoards,
  setOpenStoryAfterCreation,
  setStoryFinderAllBoards,
} from '../../../services';
import { Loading, SelectList } from '../../components';
import { useAsync, useKeyHints, useRowblyContext, useToast } from '../../hooks';
import { theme } from '../../theme';

/** The TUI's per-user preferences in `~/.rowblyrc.json`: `enter` turns the selected one on or off. */
export function PreferencesScreen() {
  const ctx = useRowblyContext();
  const toast = useToast();
  const home = ctx?.home ?? homedir();
  const preferences = useAsync(
    async () => ({
      openAfterCreation: await readOpenStoryAfterCreation(home),
      allBoards: await readStoryFinderAllBoards(home),
    }),
    [home],
  );
  useKeyHints([{ key: 'enter', description: 'turn on/off' }]);

  if (!preferences.data) return preferences.loading ? <Loading label="Loading…" /> : null;
  const { openAfterCreation: on, allBoards } = preferences.data;

  const toggle = async (key: string) => {
    try {
      const finder = key === 'finder';
      const saved = finder
        ? await setStoryFinderAllBoards(home, !allBoards)
        : await setOpenStoryAfterCreation(home, !on);
      toast.push(
        'info',
        `Turned ${saved ? 'on' : 'off'} ${finder ? 'Find Stories in full Data Root' : 'Open Story after creation'}`,
      );
      preferences.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <SelectList
        items={[
          { value: 'open-story', label: 'Open Story after creation', description: on ? 'on' : 'off' },
          { value: 'finder', label: 'Find Stories in full Data Root', description: allBoards ? 'on' : 'off' },
        ]}
        onSelect={(item) => void toggle(item.value)}
      />
      <Text color={theme.inkFaint}>
        On: a new Story opens once it is saved. Off: you return to the Board or list you created it from. Saved in
        ~/.rowblyrc.json for every Data Root.
      </Text>
      <Text color={theme.inkFaint}>
        Find Stories in full Data Root: on searches every Board; off searches the current Board. Saved in
        ~/.rowblyrc.json for every Data Root.
      </Text>
    </Box>
  );
}
