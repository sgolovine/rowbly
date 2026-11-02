import { Text } from 'ink';
import type { ConfigLevel } from '../../../schemas';
import type { ConfigTarget } from '../../../services';
import { theme } from '../../theme';

/** Explains the selected list and what editing it changes. */
export function ConfigScopeNote({ level, source }: { level: ConfigTarget['level']; source?: ConfigLevel }) {
  if (!source) return null;
  const message =
    level === 'global'
      ? 'Global defaults for Boards without their own list. Changes apply to those Boards.'
      : source === 'board'
        ? 'This Board uses its own list. Changes to global defaults do not change it.'
        : source === 'global'
          ? 'This Board uses the global list. The first edit copies it to this Board; global defaults stay unchanged.'
          : 'This Board uses the built-in defaults. The first edit copies them to this Board; global defaults stay unchanged.';
  return <Text color={theme.inkFaint}>{message}</Text>;
}
