import { colors, renderTable } from '../../output';
import type { FeatureFlag } from '../../services';

export function renderFeatureFlags(flags: FeatureFlag[]): string {
  if (flags.length === 0) return colors.dim('This version of Rowbly has no Experimental Features.');
  return renderTable(
    ['KEY', 'ON', 'NAME', 'DESCRIPTION'],
    flags.map((flag) => [flag.key, flag.enabled ? 'on' : 'off', flag.name, flag.description]),
  );
}
