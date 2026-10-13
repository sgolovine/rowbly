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
        items={DESTINATIONS.map((d) => ({ value: d.label, label: d.label }))}
        limit={DESTINATIONS.length}
        onSelect={(item) => {
          const destination = DESTINATIONS.find((d) => d.label === item.value);
          if (destination) router.push(destination.screen, destination.params);
        }}
      />
    </Box>
  );
}

export const homeScreens: ScreenRegistry = {
  home: HomeScreen,
};
