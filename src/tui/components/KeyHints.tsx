import { Text } from 'ink';
import type { KeyHint } from '../keymap';
import { theme } from '../theme';

export function KeyHints({ hints }: { hints: readonly KeyHint[] }) {
  return (
    <Text wrap="truncate-end">
      {hints.map((hint, i) => (
        <Text key={`${hint.key}:${hint.description}`}>
          {i > 0 ? '  ' : ''}
          <Text bold color={theme.ink}>
            {hint.key}
          </Text>
          <Text color={theme.inkFaint}> {hint.description}</Text>
        </Text>
      ))}
    </Text>
  );
}
