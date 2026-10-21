import { Box, Text } from 'ink';
import type { BoardView } from '../hooks';
import { theme } from '../theme';
import { ViewSwitchOption } from './ViewSwitchOption';

/** The header's board view switch: the Stages side by side, or a list. `v` on the board does the same. */
export function ViewSwitch({
  view,
  onChange,
  clickable,
}: {
  view: BoardView;
  onChange(view: BoardView): void;
  clickable: boolean;
}) {
  return (
    <Box flexShrink={0} gap={1} paddingX={1}>
      <ViewSwitchOption
        label="Stages"
        selected={view === 'stages'}
        onClick={() => onChange('stages')}
        clickable={clickable}
      />
      <Text color={theme.borderControl}>/</Text>
      <ViewSwitchOption
        label="List"
        selected={view === 'list'}
        onClick={() => onChange('list')}
        clickable={clickable}
      />
      <Text backgroundColor={theme.keycap} color={theme.inkMuted}>
        {' '}
        v{' '}
      </Text>
    </Box>
  );
}
