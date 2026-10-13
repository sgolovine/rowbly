import {
  type BoardConfig,
  type ConfigLevel,
  type CustomFieldDef,
  type DataRoot,
  DEFAULT_STAGES,
  type EffectiveBoardConfig,
  type RowblyConfig,
  type Slug,
  type Stage,
} from '../schemas';
import { createRepositories } from './repositories';

/** Effective Stages and Custom Fields for a Board, with the level each came from (contracts §3). */
export async function resolveCascade(root: DataRoot, boardId: Slug): Promise<EffectiveBoardConfig> {
  const repos = createRepositories(root);
  const [global, board] = await Promise.all([repos.rootConfig.get(), repos.boards.get(boardId)]);
  return cascade(global, board);
}

/** The most specific level that defines a list replaces the levels above it (ADR-0005). */
export function cascade(global: RowblyConfig, board: BoardConfig): EffectiveBoardConfig {
  const [stages, stagesSource] = pick<Stage>(board.stages, global.stages, DEFAULT_STAGES);
  const [customFields, customFieldsSource] = pick<CustomFieldDef>(board.customFields, global.customFields, []);
  return { board, stages, stagesSource, customFields, customFieldsSource };
}

function pick<T>(board: T[] | undefined, global: T[] | undefined, fallback: readonly T[]): [T[], ConfigLevel] {
  if (board) return [board, 'board'];
  if (global) return [global, 'global'];
  return [fallback.map((item) => ({ ...item })), 'default'];
}
