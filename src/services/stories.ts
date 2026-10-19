import {
  ConflictError,
  formatStoryKey,
  NotFoundError,
  parseStoryKey,
  rankAfter,
  rankBefore,
  rankBetween,
  toTimestamp,
  UsageError,
  ValidationError,
} from '../core';
import {
  type CustomFieldValue,
  type EffectiveBoardConfig,
  formatIssues,
  type Priority,
  type Slug,
  type Stage,
  type Story,
  StorySchema,
} from '../schemas';
import { createRepositories, type Repositories, resolveCascade } from '../storage';
import { validateFieldValues } from './_customFieldValues';
import { coordinated } from './coordination';
import type { CoreChangeSet } from './plugins/changeSet';
import { invokePluginSync } from './plugins/invoke';
import { latestStory, type OperationRunner } from './plugins/runtime';
import { checkStage } from './stageValidation';
import type { RowblyContext, StoriesService, StoryFilter, StoryPatch, StorySort } from './types';

export function createStoriesService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): StoriesService {
  /** The Story's Board and its effective Stages and Custom Fields. */
  const effective = (story: Pick<Story, 'boardId'>) => resolveCascade(ctx.root, story.boardId);

  /** The next free Story Key on the Board; if that key turns out to exist, re-scans once. */
  async function nextKey(boardId: Slug, prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const key = formatStoryKey(prefix, (await repos.stories.maxNumber(boardId)) + 1);
      if (!(await storyExists(key))) return key;
    }
    throw new ConflictError(`could not allocate a Story Key on Board "${boardId}"`, {
      hint: 'run `rowbly doctor`',
    });
  }

  async function storyExists(key: string): Promise<boolean> {
    try {
      await repos.stories.findByKey(key);
      return true;
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }

  async function storiesInScope(boardId: Slug | null): Promise<Story[]> {
    if (boardId !== null) {
      await repos.boards.get(boardId);
      return repos.stories.allInBoard(boardId);
    }
    const boards = await repos.boards.list();
    const all = await Promise.all(boards.map((b) => repos.stories.allInBoard(b.id)));
    return all.flat();
  }

  return {
    async list(boardId, filter) {
      const stories = (await storiesInScope(boardId)).filter(pluginMatcher(filter));
      const configs = new Map<string, EffectiveBoardConfig>();
      for (const story of stories) {
        if (!configs.has(story.boardId)) configs.set(story.boardId, await effective(story));
      }
      const stagesOf = (story: Story) => configs.get(story.boardId)?.stages ?? [];
      const matches = storyMatcher(filter, stagesOf);
      const boardOrder = [...configs.keys()];
      return stories.filter(matches).sort((a, b) => {
        const byDefault =
          boardOrder.indexOf(a.boardId) - boardOrder.indexOf(b.boardId) ||
          stageIndex(stagesOf(a), a.stage) - stageIndex(stagesOf(b), b.stage) ||
          compareRanks(a.rank, b.rank);
        return sortBy(filter.sort ?? 'rank', a, b) || byDefault;
      });
    },

    get: (key) => repos.stories.findByKey(key),

    create: (boardId, input) =>
      ops.run(
        'stories.create',
        { boardId, ...input },
        async (changes) => {
          const config = await resolveCascade(ctx.root, boardId);
          const stage = input.stage ?? config.stages[0]?.key;
          if (stage === undefined) throw new ValidationError('the Board has no Stages');
          checkStage(config.stages, stage);
          const customFields = validateFieldValues(config.customFields, input.customFields ?? {}, {
            requireRequired: true,
          });
          const existing = await repos.stories.allInBoard(boardId);
          const rank = rankAfter(bottomRank(existing, stage));
          const now = toTimestamp(ctx.now());
          const key = await nextKey(boardId, config.board.keyPrefix);
          return changes.putStory(
            parseStory({
              version: 1,
              key,
              boardId,
              name: input.name,
              description: input.description ?? '',
              stage,
              rank,
              priority: input.priority ?? null,
              labels: unique(input.labels ?? []),
              dueDate: input.dueDate ?? null,
              customFields,
              createdBy: ctx.me,
              createdAt: now,
              updatedAt: now,
              nextTaskNumber: 1,
              tasks: [],
            }),
          );
        },
        latestStory,
      ),

    update: (key, patch) =>
      ops.run(
        'stories.update',
        { key, ...patch },
        async (changes) => {
          const story = await repos.stories.findByKey(key);
          checkListPatch('labels', patch.labels, patch.addLabels, patch.removeLabels);
          const next: Story = { ...story };
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.description !== undefined) next.description = patch.description;
          if (patch.priority !== undefined) next.priority = patch.priority;
          if (patch.labels !== undefined) next.labels = unique(patch.labels);
          else if (patch.addLabels || patch.removeLabels) {
            const removed = patch.removeLabels ?? [];
            next.labels = unique([...story.labels, ...(patch.addLabels ?? [])]).filter((l) => !removed.includes(l));
          }
          if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
          if (patch.customFields !== undefined || patch.unsetFields !== undefined) {
            next.customFields = await updateFields(story, patch);
          }
          // A new Stage is the same change `move` makes, in this one operation (ARCH-43); the same Stage keeps the Rank.
          if (patch.stage != null && patch.stage !== story.stage) {
            next.stage = patch.stage;
            next.rank = await destinationRank(story, patch.stage);
          }
          next.updatedAt = toTimestamp(ctx.now());
          return changes.putStory(parseStory(next));
        },
        latestStory,
      ),

    move: (key, stage, opts = {}) =>
      ops.run(
        'stories.move',
        { key, stage, ...opts, top: opts.top ?? false },
        async (changes) => {
          const story = await repos.stories.findByKey(key);
          return save(changes, { ...story, stage, rank: await destinationRank(story, stage, opts.top) });
        },
        latestStory,
      ),

    rank: (key, position, opts = {}) =>
      ops.run(
        'stories.rank',
        { key, position, ...opts },
        async (changes) => {
          const story = await repos.stories.findByKey(key);
          const column = (await repos.stories.allInBoard(story.boardId))
            .filter((s) => s.stage === story.stage && s.key !== story.key)
            .sort((a, b) => compareRanks(a.rank, b.rank));
          let rank: string;
          if (position === 'top') rank = rankBefore(column[0]?.rank ?? null);
          else if (position === 'bottom') rank = rankAfter(column.at(-1)?.rank ?? null);
          else {
            const before = 'before' in position;
            const targetKey = parseStoryKey(before ? position.before : position.after).key;
            if (targetKey === story.key) throw new UsageError(`cannot rank ${story.key} relative to itself`);
            const index = column.findIndex((s) => s.key === targetKey);
            if (index === -1) {
              await repos.stories.findByKey(targetKey);
              throw new UsageError(`${targetKey} is not in ${story.key}'s Stage "${story.stage}" on the same Board`, {
                hint: 'Rank is scoped to a Stage; use `rowbly stories move` to change Stage',
              });
            }
            const lower = before ? column[index - 1] : column[index];
            const upper = before ? column[index] : column[index + 1];
            rank = between(lower?.rank ?? null, upper?.rank ?? null);
          }
          return save(changes, { ...story, rank });
        },
        latestStory,
      ),

    remove: (key, opts = {}) =>
      ops.run('stories.remove', { key, ...opts }, async (changes) => {
        // Its folder goes with it, Plugin files included (ADR-0013).
        await changes.deleteStory((await repos.stories.findByKey(key)).key);
      }),

    async labelsInUse(boardId) {
      const labels = (await repos.stories.allInBoard(boardId)).flatMap((s) => s.labels);
      return [...new Set(labels)].sort();
    },
  };

  /** Checks `stage` and gives the Story a Rank at the bottom (or `top`) of it, among the Board's other Stories. */
  async function destinationRank(story: Story, stage: Slug, top = false): Promise<string> {
    checkStage((await effective(story)).stages, stage);
    const others = (await repos.stories.allInBoard(story.boardId)).filter((s) => s.key !== story.key);
    return top ? rankBefore(topRank(others, stage)) : rankAfter(bottomRank(others, stage));
  }

  function save(changes: CoreChangeSet, story: Story): Promise<Story> {
    return changes.putStory({ ...story, updatedAt: toTimestamp(ctx.now()) });
  }

  /**
   * Each Plugin filter in `filter.plugins` must match, through its Plugin's `filterStories`. A filter is
   * parsed by the Plugin's `storyFilterSchema` once here, before any Story is checked (DX-07).
   */
  function pluginMatcher(filter: StoryFilter): (story: Story) => boolean {
    const checks = Object.entries(filter.plugins ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([id, value]) => {
        const plugin = ctx.plugins?.active().find((p) => p.definition.id === id);
        if (!plugin?.definition.filterStories) {
          throw new UsageError(`Plugin "${id}" cannot filter Stories`, { hint: 'is it on? see `rowbly plugins list`' });
        }
        const match = plugin.definition.filterStories;
        const schema = plugin.definition.storyFilterSchema;
        const parsed = schema ? schema.safeParse(value) : { success: true as const, data: value };
        if (!parsed.success) {
          throw new ValidationError(
            `Plugin "${id}" filter is not valid: ${formatIssues(parsed.error.issues, 'filter')}`,
            { details: { plugin: id, stage: 'filter', issues: parsed.error.issues } },
          );
        }
        const criteria = parsed.data;
        const context = ops.context(id);
        // A throwing filter fails the list, attributed; it never reads as "no match" (DX-39).
        return (story: Story) =>
          invokePluginSync({ plugin: id, stage: 'filter' }, () => match(story, criteria, context));
      });
    return (story) => checks.every((check) => check(story));
  }

  /** Sets the given values, removes `unsetFields`; required fields must still have a value. */
  async function updateFields(story: Story, patch: StoryPatch): Promise<Record<Slug, CustomFieldValue>> {
    const merged: Record<Slug, CustomFieldValue> = { ...story.customFields, ...patch.customFields };
    for (const key of patch.unsetFields ?? []) delete merged[key];
    return validateFieldValues((await effective(story)).customFields, merged, { requireRequired: true });
  }
}

/** What a Story on a Board can be set to, for the TUI's story form and filters. */
export interface StoryChoices extends EffectiveBoardConfig {
  /** Labels already used on the Board. */
  labels: string[];
}

export async function storyChoices(ctx: RowblyContext, boardId: Slug): Promise<StoryChoices> {
  const repos = createRepositories(ctx.root);
  const [config, labels] = await coordinated(ctx.root, 'stories.choices', () =>
    Promise.all([
      resolveCascade(ctx.root, boardId),
      repos.stories.allInBoard(boardId).then((stories) => [...new Set(stories.flatMap((s) => s.labels))].sort()),
    ]),
  );
  return { ...config, labels };
}

/** Every given filter must match (contracts §5). */
function storyMatcher(filter: StoryFilter, stagesOf: (story: Story) => readonly Stage[]): (story: Story) => boolean {
  const search = filter.search?.toLowerCase();
  return (story) => {
    const category = stagesOf(story).find((s) => s.key === story.stage)?.category;
    if (filter.stages?.length && !filter.stages.includes(story.stage)) return false;
    if (filter.category && category !== filter.category) return false;
    if (filter.open && category === 'done') return false;
    if (filter.labels?.length && !story.labels.some((l) => filter.labels?.includes(l))) return false;
    if (filter.priorities?.length && !(story.priority && filter.priorities.includes(story.priority))) return false;
    if (search && !`${story.name}\n${story.description}`.toLowerCase().includes(search)) return false;
    return true;
  };
}

const PRIORITY_ORDER: readonly Priority[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

/** `priority` most urgent first, `created` oldest first, `updated` newest first, `due` soonest first; unset values last. */
function sortBy(sort: StorySort, a: Story, b: Story): number {
  switch (sort) {
    case 'rank':
      return 0;
    case 'priority':
      return orderOf(a.priority) - orderOf(b.priority);
    case 'created':
      return compareRanks(a.createdAt, b.createdAt);
    case 'updated':
      return compareRanks(b.updatedAt, a.updatedAt);
    case 'due':
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return compareRanks(a.dueDate, b.dueDate);
  }
}

function orderOf(priority: Priority | null): number {
  return priority === null ? PRIORITY_ORDER.length : PRIORITY_ORDER.indexOf(priority);
}

/** Unknown Stages (drift) sort after the known ones. */
function stageIndex(stages: readonly Stage[], key: string): number {
  const index = stages.findIndex((s) => s.key === key);
  return index === -1 ? stages.length : index;
}

/** `--label` replaces the list, so it cannot be combined with the add/remove flags. */
function checkListPatch(name: string, replace?: unknown[], add?: unknown[], remove?: unknown[]): void {
  if (replace !== undefined && (add !== undefined || remove !== undefined)) {
    throw new UsageError(`replace ${name} or add/remove them, not both`);
  }
}

function bottomRank(stories: readonly Story[], stage: string): string | null {
  return stories
    .filter((s) => s.stage === stage)
    .reduce<string | null>((max, s) => (max === null || s.rank > max ? s.rank : max), null);
}

function topRank(stories: readonly Story[], stage: string): string | null {
  return stories
    .filter((s) => s.stage === stage)
    .reduce<string | null>((min, s) => (min === null || s.rank < min ? s.rank : min), null);
}

/** A Rank between two neighbours; equal neighbour Ranks (a merge artefact) cannot be split. */
function between(lower: string | null, upper: string | null): string {
  if (lower !== null && upper !== null && lower >= upper) {
    throw new ConflictError('neighbouring Stories share a Rank', { hint: 'run `rowbly doctor --fix`' });
  }
  return rankBetween(lower, upper);
}

/** Rank keys (and ISO strings) compare by code unit, not locale. */
function compareRanks(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function parseStory(input: unknown): Story {
  const result = StorySchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  const summary = issues.map((issue) => `${issue.path.join('.') || 'story'}: ${issue.message}`).join('; ');
  throw new ValidationError(`invalid Story: ${summary}`, { details: { issues } });
}
