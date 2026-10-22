import { colorByCategory, colors, describeSource, renderTable } from '../../output';
import type { CustomFieldDef, EffectiveBoardConfig } from '../../schemas';
import type { Identity } from '../../services';
import { type CreateDataRootResult, shellArg } from '../../services/setup';
import type { ContextSource, CurrentContext } from './types';

const SOURCE_LABELS: Record<ContextSource, string> = {
  flag: 'from flag',
  env: 'from environment',
  local: 'from local.json',
  only: 'the only one',
};

export function renderCurrentContext({ board }: CurrentContext): string {
  return `Board  ${board ? `${colors.bold(board.id)}  ${colors.dim(`(${SOURCE_LABELS[board.source]})`)}` : colors.dim('(none)')}`;
}

function renderIdentity({ me, source, global }: Identity): string {
  if (me === null) return 'Me is not set. Claim a handle with `rowbly whoami <handle>`.';
  if (source === 'global') return `${colors.bold(me)}  ${colors.dim('(global Me)')}`;
  return `${colors.bold(me)}  ${colors.dim(global ? `(local Me; global Me is ${global})` : '(local Me)')}`;
}

function renderSetGlobal({ me, local }: Identity, change: string | null): string {
  if (local === null) return change === null ? 'Cleared global Me' : `You are ${change}`;
  const first = change === null ? 'Cleared global Me' : `Global Me is ${change}`;
  return `${first}\nIn this Data Root you are ${me}, its local Me (\`rowbly whoami --local --clear\` removes it)`;
}

export function renderSetLocal(result: Identity, change: string | null | undefined): string {
  if (change === undefined) return renderIdentity(result);
  if (change !== null) return `You are ${change} in this Data Root`;
  return result.me === null ? 'Cleared the local Me; Me is not set' : `Cleared the local Me; you are ${result.me}`;
}

export function renderInit(result: CreateDataRootResult): string {
  const name = result.known.label ? ` "${result.known.label}"` : '';
  const lines = [`Created Data Root${name} ${result.root.path}${result.known.default ? ' (the default)' : ''}`];
  if (result.board) {
    lines.push(`Created Board ${result.board.id} (${result.board.keyPrefix})`, `Now using ${result.board.id}`);
  } else {
    // It names the new Data Root, since a default Data Root would otherwise be opened ahead of it.
    lines.push(
      `Next: \`rowbly --data-root ${shellArg(result.root.path)} boards create <id> --name <name> --prefix <PREFIX>\``,
    );
  }
  return lines.join('\n');
}

export function renderEffective(config: EffectiveBoardConfig): string {
  const { board } = config;
  const stages = renderTable(
    ['KEY', 'NAME', 'CATEGORY'],
    config.stages.map((s) => [s.key, s.name, colorByCategory(s.category, s.category)]),
  );
  const fields =
    config.customFields.length === 0
      ? colors.dim('none')
      : renderTable(['KEY', 'NAME', 'TYPE', 'REQUIRED', 'OPTIONS'], config.customFields.map(renderFieldRow));
  return [
    `${colors.bold(board.id)}  ${board.name} (${board.keyPrefix})`,
    '',
    `Stages ${colors.dim(`(${describeSource(config.stagesSource)})`)}`,
    stages,
    '',
    `Custom Fields ${colors.dim(`(${describeSource(config.customFieldsSource)})`)}`,
    fields,
  ].join('\n');
}

function renderFieldRow(field: CustomFieldDef): string[] {
  const options = 'options' in field ? field.options.join(', ') : '';
  return [field.key, field.name, field.type, field.required ? 'yes' : '', options];
}

export function renderContextCleared(): string {
  return 'Cleared the current Board';
}

export function renderContextSet(local: { board?: string }): string {
  return `Now using ${local.board}`;
}

export function renderGlobalIdentity(result: Identity, change: string | null | undefined): string {
  return change === undefined ? renderIdentity(result) : renderSetGlobal(result, change);
}
