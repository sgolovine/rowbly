import type { OverrideLevels } from '../services/workspaces';

/** Where a Workspace's Stages or Custom Fields lists are defined, e.g. `defined at global, board web`. */
export function describeOverrides(levels: OverrideLevels, fallback: string): string {
  const defined = [
    ...(levels.global ? ['global'] : []),
    ...(levels.workspace ? ['workspace'] : []),
    ...levels.boards.map((board) => `board ${board}`),
  ];
  return defined.length === 0 ? fallback : `defined at ${defined.join(', ')}`;
}
