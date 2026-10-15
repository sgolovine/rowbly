import { Box, Text } from 'ink';
import { SelectList } from '../../components';
import { pluginRoute, useKeyHints, usePlugins } from '../../hooks';
import { DESTINATIONS, type Destination } from '../../keymap';
import { useRouter } from '../../router';

/** The root menu: every go-to destination, then those the Plugins add. */
export function HomeScreen() {
  const router = useRouter();
  const { plugins } = usePlugins();
  useKeyHints([{ key: 'enter', description: 'open' }]);
  // Each destination's value is where it comes from and its place there, never its label (ARCH-40).
  const destinations: (Destination & { value: string })[] = [
    ...DESTINATIONS.map((d, i) => ({ ...d, value: `core:${d.screen}:${i}` })),
    ...plugins.flatMap((plugin) =>
      (plugin.tui.home ?? []).map((link, i) => ({
        value: `plugin:${plugin.id}:${i}`,
        label: link.label,
        ...pluginRoute(plugin.id, link.screen, { title: link.label, ...link.params }),
      })),
    ),
  ];
  return (
    <Box flexDirection="column">
      <Text bold>Go to</Text>
      <SelectList
        items={destinations.map((d) => ({ value: d.value, label: d.label }))}
        limit={destinations.length}
        onSelect={(item) => {
          const destination = destinations.find((d) => d.value === item.value);
          if (destination) router.push(destination.screen, destination.params);
        }}
      />
    </Box>
  );
}
