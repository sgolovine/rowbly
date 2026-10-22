import { colorByCategory, colors, renderTable } from '../../output';
import type { ConfigLevel, Slug, Stage } from '../../schemas';
import type { ConfigTarget } from '../../services';
import type { MutationResult } from './types';

export function renderTarget(target: ConfigTarget): string {
  if (target.level === 'global') return 'global level';
  return `board level (${target.boardId})`;
}

export function renderAffectsLine(target: ConfigTarget, boards: readonly Slug[]): string {
  return colors.dim(`${renderTarget(target)}; affects ${boards.length === 0 ? 'no Boards' : boards.join(', ')}`);
}

export function renderMutation(
  result: MutationResult<Stage>,
  target: ConfigTarget,
  key: string,
  verb: 'Added' | 'Updated' | 'Moved',
): string {
  return [
    `${verb} Stage ${key}`,
    renderStageTable(result.items),
    renderAffectsLine(target, result.affectedBoards),
  ].join('\n');
}

export function renderStageList(target: ConfigTarget, stages: readonly Stage[], source: ConfigLevel): string {
  return [colors.dim(`${renderTarget(target)}; from ${source}`), renderStageTable(stages)].join('\n');
}

function renderStageTable(stages: readonly Stage[]): string {
  return renderTable(
    ['#', 'KEY', 'NAME', 'CATEGORY'],
    stages.map((s, i) => [String(i + 1), s.key, colorByCategory(s.category, s.name), s.category]),
  );
}

export function renderStageRemoved(
  target: ConfigTarget,
  key: string,
  moveTo: string | undefined,
  result: { storiesMoved: number; affectedBoards: Slug[] },
): string {
  return [
    `Removed Stage ${key}${result.storiesMoved > 0 ? `; moved ${result.storiesMoved} Stories to ${moveTo}` : ''}`,
    renderAffectsLine(target, result.affectedBoards),
  ].join('\n');
}
