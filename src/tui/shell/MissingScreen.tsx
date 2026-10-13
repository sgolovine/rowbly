import { Text } from 'ink';
import { useEffect } from 'react';

export function MissingScreen({ name, onMount }: { name: string; onMount(): void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: report once, when the screen opens.
  useEffect(onMount, []);
  return <Text dimColor>The "{name}" screen is not available yet. Press esc to go back.</Text>;
}
