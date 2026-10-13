import { Text } from 'ink';

export interface CommentsPanelProps {
  /** A Story Key or a Task id. */
  target: string;
}

// Placeholder: WP06 replaces this. WP05's story detail screen renders it in the Comments tab.
export function CommentsPanel({ target }: CommentsPanelProps) {
  return <Text>Comments on {target}: not implemented (WP06)</Text>;
}
