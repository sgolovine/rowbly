import { homedir } from 'node:os';
import { Box, Text } from 'ink';
import { readOpenStoryAfterCreation, setOpenStoryAfterCreation } from '../../../services';
import { Loading, SelectList } from '../../components';
import { useAsync, useKeyHints, useRowblyContext, useToast } from '../../hooks';
import { theme } from '../../theme';

/** The TUI's per-user preferences in `~/.rowblyrc.json`: `enter` turns the selected one on or off. */
export function PreferencesScreen() {
  const ctx = useRowblyContext();
  const toast = useToast();
  const home = ctx?.home ?? homedir();
  const openAfterCreation = useAsync(() => readOpenStoryAfterCreation(home), [home]);
  useKeyHints([{ key: 'enter', description: 'turn on/off' }]);

  if (openAfterCreation.data === undefined) return openAfterCreation.loading ? <Loading label="Loading…" /> : null;
  const on = openAfterCreation.data;

  const toggle = async () => {
    try {
      const saved = await setOpenStoryAfterCreation(home, !on);
      toast.push('info', `Turned ${saved ? 'on' : 'off'} Open Story after creation`);
      openAfterCreation.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <SelectList
        items={[{ value: 'open-story', label: 'Open Story after creation', description: on ? 'on' : 'off' }]}
        onSelect={() => void toggle()}
      />
      <Text color={theme.inkFaint}>
        On: a new Story opens once it is saved. Off: you return to the Board or list you created it from. Saved in
        ~/.rowblyrc.json for every Data Root.
      </Text>
    </Box>
  );
}
