import { Text } from 'ink';
import type { KnownDataRootChoice } from '../../services';
import { SelectListRow } from '../components';
import { useLayout } from '../hooks';
import { theme } from '../theme';
import { dataRootName, tildePath } from './dataRootName';

/** The row marker and the path's indent. */
const PATH_INDENT = 6;

/**
 * A known Data Root in the switcher: its name, whether it is current, the default or missing, and
 * its path on the line below, cut from the start to the width of the modal.
 */
export function DataRootRow({
  root,
  home,
  highlighted,
  active,
  onClick,
}: {
  root: KnownDataRootChoice;
  home: string;
  highlighted: boolean;
  active: boolean;
  onClick?(): void;
}) {
  const { width } = useLayout();
  const path = tildePath(root.path, home);
  const room = Math.max(8, width - PATH_INDENT);
  return (
    <SelectListRow highlighted={highlighted} active={active} onClick={onClick}>
      {dataRootName(root)}
      {root.current && <Text color={theme.accent}> · current</Text>}
      {root.default && <Text color={theme.inkMuted}> · default</Text>}
      {root.missing && <Text color={theme.danger}> · missing</Text>}
      <Text color={theme.inkFaint} bold={false}>
        {'\n    '}
        {path.length > room ? `…${path.slice(path.length - room + 1)}` : path}
      </Text>
    </SelectListRow>
  );
}
