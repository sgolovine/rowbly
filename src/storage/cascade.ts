import {
  type BoardConfig,
  type ConfigLevel,
  type CustomFieldDef,
  type DataRoot,
  DEFAULT_STAGES,
  type EffectiveBoardConfig,
  type EffectiveGlobalConfig,
  type RowblyConfig,
  type Slug,
  type StageConfig,
  withFixedStages,
} from '../schemas';
import { createRepositories } from './repositories';

/** Effective Stages and Custom Fields for a Board, with the level each came from (contracts §3). */
export async function resolveCascade(root: DataRoot, boardId: Slug): Promise<EffectiveBoardConfig> {
  const repos = createRepositories(root);
  const [global, board] = await Promise.all([repos.rootConfig.get(), repos.boards.get(boardId)]);
  return cascade(global, board);
}

/** Effective Stages and Custom Fields at the global level, with the stored `rowbly.config.json`. */
export async function resolveGlobal(root: DataRoot): Promise<EffectiveGlobalConfig> {
  const config = await createRepositories(root).rootConfig.get();
  const [configured, stagesSource] = pick<StageConfig>(undefined, config.stages, DEFAULT_STAGES);
  const [customFields, customFieldsSource] = pick<CustomFieldDef>(undefined, config.customFields, []);
  return {
    config,
    stages: withFixedStages(configured),
    stagesSource: stagesSource === 'global' ? 'global' : 'default',
    customFields,
    customFieldsSource: customFieldsSource === 'global' ? 'global' : 'default',
  };
}

/**
 * The most specific level that defines a list replaces the levels above it (ADR-0005). Backlog and Done
 * surround the configured Stages (ADR-0024).
 */
export function cascade(global: RowblyConfig, board: BoardConfig): EffectiveBoardConfig {
  const [configured, stagesSource] = pick<StageConfig>(board.stages, global.stages, DEFAULT_STAGES);
  const stages = withFixedStages(configured);
  const [customFields, customFieldsSource] = pick<CustomFieldDef>(board.customFields, global.customFields, []);
  return { board, stages, stagesSource, customFields, customFieldsSource };
}

function pick<T>(board: T[] | undefined, global: T[] | undefined, fallback: readonly T[]): [T[], ConfigLevel] {
  if (board) return [board, 'board'];
  if (global) return [global, 'global'];
  return [fallback.map((item) => ({ ...item })), 'default'];
}
