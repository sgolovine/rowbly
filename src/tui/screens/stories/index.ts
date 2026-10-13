import type { ScreenRegistry } from '../types';
import { StoryDetailScreen } from './detail';
import { StoryFormScreen } from './form';
import { StoryListScreen } from './list';

export const storiesScreens: ScreenRegistry = {
  stories: StoryListScreen,
  story: StoryDetailScreen,
  'story-form': StoryFormScreen,
};
