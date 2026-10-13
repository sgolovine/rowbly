import { Box, Text } from 'ink';
import { SelectList } from '../../components';
import { pluginRoute, useKeyHints, usePlugins } from '../../hooks';
import { DESTINATIONS, type Destination } from '../../keymap';
import { useRouter } from '../../router';
import type { ScreenRegistry } from '../types';

/** The root menu: every go-to destination, then those the Plugins add. */
function HomeScreen() {
  const router = useRouter();
  const { plugins } = usePlugins();
  useKeyHints([{ key: 'enter', description: 'open' }]);
  const destinations: Destination[] = [
    ...DESTINATIONS,
    ...plugins.flatMap((plugin) =>
      (plugin.tui.home ?? []).map((link) => ({
        label: link.label,
        ...pluginRoute(plugin.id, link.screen, { title: link.label, ...link.params }),
      })),
    ),
  ];
  return (
    <Box flexDirection="column">
      <Text bold>Go to</Text>
      <SelectList
        items={destinations.map((d) => ({ value: d.label, label: d.label }))}
        limit={destinations.length}
        onSelect={(item) => {
          const destination = destinations.find((d) => d.label === item.value);
          if (destination) router.push(destination.screen, destination.params);
        }}
      />
    </Box>
  );
}

export const homeScreens: ScreenRegistry = {
  home: HomeScreen,
};
