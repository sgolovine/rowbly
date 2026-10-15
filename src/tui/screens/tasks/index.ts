import type { ScreenRegistry } from '../types';
import { TaskDetailScreen } from './TaskDetailScreen';
import { TaskFormScreen } from './TaskFormScreen';

// The Tasks tab itself (`StoryTasksTab`) is embedded in the Story detail screen.
export { StoryTasksTab } from './StoryTasksTab';

export const tasksScreens: ScreenRegistry = {
  task: TaskDetailScreen,
  'task-form': TaskFormScreen,
};
