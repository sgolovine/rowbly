import type { ScreenRegistry } from '../types';
import { StoryDetailScreen } from './StoryDetailScreen';
import { StoryFormScreen } from './StoryFormScreen';
import { StoryListScreen } from './StoryListScreen';

export { describeFilters, filterFields, filterInitialValues, toFilter } from './filter';
export { PluginFailures } from './PluginFailures';
export { describeWithPlugins, storyFilterFields, withPluginFilters } from './pluginFields';

export const storiesScreens: ScreenRegistry = {
  stories: StoryListScreen,
  story: StoryDetailScreen,
  'story-form': StoryFormScreen,
};
