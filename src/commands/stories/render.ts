import { colorByCategory, colors, renderTable } from '../../output';
import type { CustomFieldDef, CustomFieldValue, Stage, Story } from '../../schemas';

/** A Stage name coloured by its Stage Category; an unknown Stage (drift) shows its key in red. */
function renderStageBadge(stages: readonly Stage[], key: string): string {
  const stage = stages.find((s) => s.key === key);
  return stage ? colorByCategory(stage.category, `● ${stage.name}`) : colors.red(`● ${key}?`);
}

export function renderStories(stories: readonly Story[], stages: Map<string, Stage[]>): string {
  if (stories.length === 0) return colors.dim('No Stories match.');
  return renderTable(
    ['KEY', 'NAME', 'STAGE', 'PRIORITY', 'LABELS', 'DUE'],
    stories.map((s) => [
      s.key,
      s.name,
      renderStageBadge(stages.get(s.boardId) ?? [], s.stage),
      s.priority ?? '',
      s.labels.join(', '),
      s.dueDate ?? '',
    ]),
  );
}

export function renderStory(
  story: Story,
  stages: readonly Stage[],
  fields: readonly CustomFieldDef[],
  extra: readonly [string, string][],
): string {
  const none = colors.dim('—');
  const rows: [string, string][] = [
    ['Stage', renderStageBadge(stages, story.stage)],
    ['Priority', story.priority ?? none],
    ['Labels', story.labels.join(', ') || none],
    ['Due', story.dueDate ?? none],
    ...extra,
    ['Created', `${story.createdAt}${story.createdBy ? ` by ${story.createdBy}` : ''}`],
    ['Updated', story.updatedAt],
  ];
  const lines = [`${colors.bold(story.key)}  ${colors.bold(story.name)}`, ...renderLabelled(rows)];
  const values = Object.entries(story.customFields);
  if (values.length > 0) {
    lines.push('', colors.bold('Custom Fields'));
    lines.push(
      ...renderLabelled(
        values.map(([key, value]) => [fields.find((f) => f.key === key)?.name ?? key, renderFieldValue(value)]),
      ),
    );
  }
  if (story.description.trim()) lines.push('', colors.bold('Description'), story.description);
  return lines.join('\n');
}

function renderLabelled(rows: readonly [string, string][]): string[] {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, value]) => `${colors.dim(`${label}:`.padEnd(width))}${value}`);
}

function renderFieldValue(value: CustomFieldValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function renderStoryCreated(story: Story): string {
  return `Created ${story.key}: ${story.name}`;
}

export function renderStoryUpdated(story: Story): string {
  return `Updated ${story.key}`;
}

export function renderStoryMoved(story: Story): string {
  return `Moved ${story.key} to ${story.stage}`;
}

export function renderStoryRanked(story: Story): string {
  return `Ranked ${story.key}`;
}

export function renderStoryDeleted(result: { deleted: string }): string {
  return `Deleted ${result.deleted}`;
}

export function renderJsonOnly(): string {
  return '';
}
