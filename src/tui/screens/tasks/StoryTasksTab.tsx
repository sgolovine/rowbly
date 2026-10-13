import { Text } from 'ink';

export interface StoryTasksTabProps {
  storyKey: string;
}

// Placeholder: WP06 replaces this. WP05's story detail screen renders it in the Tasks tab.
export function StoryTasksTab({ storyKey }: StoryTasksTabProps) {
  return <Text>Tasks for {storyKey}: not implemented (WP06)</Text>;
}
