import { colorByCategory, colors, describeSource, renderTable } from '../../output';
import type { BoardConfig, CustomFieldDef, EffectiveBoardConfig } from '../../schemas';

export function renderBoards(boards: BoardConfig[]): string {
  if (boards.length === 0) return colors.dim('No Boards yet. Create one with `rowbly boards create <id>`.');
  return renderTable(
    ['ID', 'PREFIX', 'NAME', 'DESCRIPTION'],
    boards.map((b) => [b.id, b.keyPrefix, b.name, b.description]),
  );
}

export function renderBoardShow(data: EffectiveBoardConfig & { storyCounts: Record<string, number> }): string {
  const { board, storyCounts } = data;
  const lines = [`${colors.bold(board.name)} ${colors.dim(board.id)}`, `Key prefix: ${board.keyPrefix}`];
  if (board.description) lines.push(board.description);
  lines.push(
    '',
    colors.bold(`Stages (${describeSource(data.stagesSource)})`),
    renderTable(
      ['KEY', 'NAME', 'CATEGORY', 'STORIES'],
      data.stages.map((s) => [s.key, colorByCategory(s.category, s.name), s.category, String(storyCounts[s.key] ?? 0)]),
    ),
  );
  const unknown = Object.keys(storyCounts).filter((key) => !data.stages.some((s) => s.key === key));
  for (const key of unknown) {
    lines.push(colors.yellow(`${storyCounts[key]} Stories are in unknown Stage "${key}" (run \`rowbly doctor\`)`));
  }
  lines.push('', colors.bold(`Custom Fields (${describeSource(data.customFieldsSource)})`));
  lines.push(data.customFields.length === 0 ? colors.dim('none') : renderFieldTable(data.customFields));
  return lines.join('\n');
}

/** KEY, NAME, TYPE, REQUIRED and the type-specific settings of each Custom Field. */
export function renderFieldTable(fields: readonly CustomFieldDef[]): string {
  return renderTable(
    ['KEY', 'NAME', 'TYPE', 'REQUIRED', 'SETTINGS'],
    fields.map((f) => [f.key, f.name, f.type, f.required ? 'yes' : 'no', renderFieldSettings(f)]),
  );
}

function renderFieldSettings(f: CustomFieldDef): string {
  if (f.type === 'select' || f.type === 'multiselect') return f.options.join(', ');
  if (f.type === 'number') {
    return [
      f.integer ? 'integer' : '',
      f.min !== undefined ? `min ${f.min}` : '',
      f.max !== undefined ? `max ${f.max}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

export function renderBoardCreated(board: BoardConfig): string {
  return `Created Board ${board.id} (${board.keyPrefix})`;
}

export function renderBoardUpdated(board: BoardConfig): string {
  return `Updated Board ${board.id}`;
}

export function renderBoardDeleted(result: { deleted: string }): string {
  return `Deleted Board ${result.deleted}`;
}
