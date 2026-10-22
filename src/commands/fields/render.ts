import { colors } from '../../output';
import type { ConfigLevel, CustomFieldDef, Slug } from '../../schemas';
import type { ConfigTarget } from '../../services';
import { renderFieldTable } from '../boards/render';
import { type MutationResult, renderAffectsLine, renderTarget } from '../stages';

export function renderMutation(
  result: MutationResult<CustomFieldDef>,
  target: ConfigTarget,
  key: string,
  verb: 'Added' | 'Updated',
): string {
  return [
    `${verb} Custom Field ${key}`,
    renderFieldTable(result.items),
    renderAffectsLine(target, result.affectedBoards),
  ].join('\n');
}

export function renderFields(target: ConfigTarget, fields: readonly CustomFieldDef[], source: ConfigLevel): string {
  return [
    colors.dim(`${renderTarget(target)}; from ${source}`),
    fields.length === 0 ? colors.dim('No Custom Fields.') : renderFieldTable(fields),
  ].join('\n');
}

export function renderFieldRemoved(
  target: ConfigTarget,
  key: string,
  result: { valuesStripped: number; affectedBoards: Slug[] },
): string {
  return [
    `Removed Custom Field ${key}; stripped ${result.valuesStripped} values`,
    renderAffectsLine(target, result.affectedBoards),
  ].join('\n');
}
