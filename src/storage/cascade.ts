import {
  type BoardConfig,
  type BoardRef,
  type ConfigLevel,
  type CustomFieldDef,
  type DataRoot,
  DEFAULT_STAGES,
  type EffectiveBoardConfig,
  type RowblyConfig,
  type Stage,
  type WorkspaceConfig,
} from '../schemas';
import { createRepositories } from './repositories';

/** Effective Stages and Custom Fields for a Board, with the level each came from (contracts §3). */
export async function resolveCascade(root: DataRoot, ref: BoardRef): Promise<EffectiveBoardConfig> {
  const repos = createRepositories(root);
  const [global, workspace, board] = await Promise.all([
    repos.rootConfig.get(),
    repos.workspaces.get(ref.workspaceId),
    repos.boards.get(ref),
  ]);
  return cascade(global, workspace, board);
}

/** The most specific level that defines a list replaces the levels above it (ADR-0005). */
export function cascade(global: RowblyConfig, workspace: WorkspaceConfig, board: BoardConfig): EffectiveBoardConfig {
  const [stages, stagesSource] = pick<Stage>(board.stages, workspace.stages, global.stages, DEFAULT_STAGES);
  const [customFields, customFieldsSource] = pick<CustomFieldDef>(
    board.customFields,
    workspace.customFields,
    global.customFields,
    [],
  );
  return { board, stages, stagesSource, customFields, customFieldsSource };
}

function pick<T>(
  board: T[] | undefined,
  workspace: T[] | undefined,
  global: T[] | undefined,
  fallback: readonly T[],
): [T[], ConfigLevel] {
  if (board) return [board, 'board'];
  if (workspace) return [workspace, 'workspace'];
  if (global) return [global, 'global'];
  return [fallback.map((item) => ({ ...item })), 'default'];
}
