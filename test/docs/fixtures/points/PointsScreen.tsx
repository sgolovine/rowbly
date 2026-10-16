// The tutorial's Points screen (docs/WRITING-A-PLUGIN.md, step 7).
// #region screen
import type { PluginScreenProps } from '../../../../src/plugin-api';
import {
  Box,
  Loading,
  SelectList,
  Text,
  useAsync,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
} from '../../../../src/plugin-api/tui';
import { type PointsSettings, storyPoints } from './model';

/** Every Story that has points, on every Board; `enter` opens the Story. */
export function PointsScreen({ plugin, ui }: PluginScreenProps<PointsSettings>) {
  const active = useIsActive();
  const data = useAsync(async () => {
    const stories = await plugin.services.stories.list(null, {});
    return stories.flatMap((story) => {
      const points = storyPoints(plugin, story);
      return points === undefined ? [] : [{ story, points }];
    });
  }, [plugin]);
  // Back from a Story shows what changed there.
  useReloadOnReturn(data.reload);
  useKeyHints(active ? [{ key: 'enter', description: 'open Story' }] : []);
  if (!data.data) {
    return data.loading ? <Loading label="Loading Stories…" /> : <Text color="red">Could not load Stories.</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text bold>{`${plugin.settings.label} by Story`}</Text>
      <SelectList
        items={data.data.map(({ story, points }) => ({
          value: story.key,
          label: `${story.key} · ${story.name}`,
          description: `${points} ${plugin.settings.label}`,
        }))}
        emptyText="No Story has points yet."
        isActive={active}
        onSelect={({ value }) => ui.openStory(value)}
      />
    </Box>
  );
}
// #endregion
