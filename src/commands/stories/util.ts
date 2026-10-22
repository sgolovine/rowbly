import { UsageError } from '../../core';
import {
  type Priority,
  PrioritySchema,
  type Stage,
  type StageCategory,
  StageCategorySchema,
  type Story,
} from '../../schemas';
import type { RankPosition, Services, StoryFilter, StoryPatch, StorySort } from '../../services';
import { parseFieldAssignments, parseRepeatable, readLongText } from '../shared';
import type { StoryOptions } from './types';

export const SORTS: readonly StorySort[] = ['rank', 'priority', 'created', 'updated', 'due'];

export const boardOption = ['--board <id>', 'the Board (default: current context)'] as const;

export function readDescription(opts: StoryOptions, initial?: string): Promise<string | undefined> {
  return readLongText(
    { text: opts.description, file: opts.descriptionFile, edit: opts.edit },
    { name: 'description', initial },
  );
}

export function listFilter(opts: StoryOptions): StoryFilter {
  if (opts.category !== undefined && !StageCategorySchema.options.includes(opts.category as StageCategory)) {
    throw new UsageError(`invalid --category "${opts.category}"`, {
      hint: `expected one of: ${StageCategorySchema.options.join(', ')}`,
    });
  }
  if (opts.sort !== undefined && !SORTS.includes(opts.sort as StorySort)) {
    throw new UsageError(`invalid --sort "${opts.sort}"`, { hint: `expected one of: ${SORTS.join(', ')}` });
  }
  const priorities = Array.isArray(opts.priority) ? parseRepeatable(opts.priority).map(toPriority) : [];
  const stages = Array.isArray(opts.stage) ? parseRepeatable(opts.stage) : [];
  const labels = parseRepeatable(opts.label);
  return {
    ...(stages.length ? { stages } : {}),
    ...(opts.category ? { category: opts.category as StageCategory } : {}),
    ...(opts.open ? { open: true } : {}),
    ...(labels.length ? { labels } : {}),
    ...(priorities.length ? { priorities } : {}),
    ...(opts.search ? { search: opts.search } : {}),
    ...(opts.sort ? { sort: opts.sort as StorySort } : {}),
  };
}

/** `undefined` for every flag that was not given; `false` from a `--no-*` flag becomes `null` (clear). */
export function editPatch(opts: StoryOptions, description: string | undefined): StoryPatch {
  const list = (values: string[] | undefined) => (values === undefined ? undefined : parseRepeatable(values));
  const fields = opts.field === undefined ? undefined : parseFieldAssignments(opts.field);
  const clearable = <T>(value: string | false | undefined, map: (v: string) => T) =>
    value === undefined ? undefined : value === false ? null : map(value);
  return {
    name: opts.name,
    description,
    priority: clearable(opts.priority as string | false | undefined, toPriority),
    labels: list(opts.label),
    addLabels: list(opts.addLabel),
    removeLabels: list(opts.removeLabel),
    dueDate: clearable(opts.due, (v) => v),
    customFields: fields,
    unsetFields: list(opts.unsetField),
  };
}

export function rankPosition(opts: StoryOptions): RankPosition {
  const given = [opts.before !== undefined, opts.after !== undefined, opts.top, opts.bottom].filter(Boolean);
  if (given.length !== 1) throw new UsageError('pass exactly one of --before, --after, --top and --bottom');
  if (opts.before !== undefined) return { before: opts.before };
  if (opts.after !== undefined) return { after: opts.after };
  return opts.top ? 'top' : 'bottom';
}

export function toPriority(value: string): Priority {
  const result = PrioritySchema.safeParse(value.trim().toUpperCase());
  if (!result.success) throw new UsageError(`invalid Priority "${value}"`, { hint: 'expected P0, P1, P2, P3 or P4' });
  return result.data;
}

export async function stagesByBoard(services: Services, stories: readonly Story[]): Promise<Map<string, Stage[]>> {
  const stages = new Map<string, Stage[]>();
  for (const story of stories) {
    if (stages.has(story.boardId)) continue;
    stages.set(story.boardId, (await services.config.effective(story.boardId)).stages);
  }
  return stages;
}
