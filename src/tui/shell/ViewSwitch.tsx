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
    <Box flexShrink={0} gap={1} borderStyle="round" borderColor={theme.accent}>
      <ViewSwitchOption
        label="Stages"
        selected={view === 'stages'}
        onClick={() => onChange('stages')}
        clickable={clickable}
      />
      <Text color={theme.inkFaint}>│</Text>
      <ViewSwitchOption
        label="List"
        selected={view === 'list'}
        onClick={() => onChange('list')}
        clickable={clickable}
      />
      <Text color={theme.inkFaint}>v</Text>
    </Box>
  );
}
