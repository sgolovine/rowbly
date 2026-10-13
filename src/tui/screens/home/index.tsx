import { Box, Text } from 'ink';
import { SelectList } from '../../components';
import { useKeyHints } from '../../hooks';
import { DESTINATIONS } from '../../keymap';
import { useRouter } from '../../router';
import type { ScreenRegistry } from '../types';

/** The root menu: every go-to destination. WP09 makes the board view the default instead. */
function HomeScreen() {
  const router = useRouter();
  useKeyHints([{ key: 'enter', description: 'open' }]);
  return (
    <Box flexDirection="column">
      <Text bold>Go to</Text>
      <SelectList
        items={DESTINATIONS.map((d) => ({ value: d.screen, label: d.label }))}
        onSelect={(item) => router.push(item.value)}
      />
    </Box>
  );
}

export const homeScreens: ScreenRegistry = {
  home: HomeScreen,
};
