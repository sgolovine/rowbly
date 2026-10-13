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
  type Assignee,
  type CustomFieldValue,
  type EffectiveBoardConfig,
  type Epic,
  type Priority,
  type Slug,
  type Stage,
  type Story,
  StorySchema,
} from '../schemas';
import { createRepositories, type Repositories, resolveCascade } from '../storage';
import { validateFieldValues } from './_customFieldValues';
import type { RowblyContext, StoriesService, StoryFilter, StoryPatch, StorySort } from './types';

export function createStoriesService(ctx: RowblyContext, repos: Repositories): StoriesService {
  /** The Story's Board and its effective Stages and Custom Fields. */
  const effective = (story: Pick<Story, 'boardId'>) => resolveCascade(ctx.root, story.boardId);

  /** Resolves `'me'`, drops duplicates and checks every handle against the roster. */
  async function checkAssignees(handles: readonly string[]): Promise<Slug[]> {
    const resolved = [...new Set(handles.map(resolveMe))];
    if (resolved.length === 0) return resolved;
    const roster = (await repos.rootConfig.get()).assignees.map((a) => a.handle);
    const unknown = resolved.filter((handle) => !roster.includes(handle));
    if (unknown.length > 0) {
      throw new ValidationError(
        `unknown Assignee${unknown.length > 1 ? 's' : ''} ${unknown.map((h) => `"${h}"`).join(', ')}`,
        {
          details: {
            issues: unknown.map((handle) => ({ path: ['assignees'], message: `unknown Assignee "${handle}"` })),
            validHandles: roster,
          },
          hint:
            roster.length > 0
              ? `valid handles: ${roster.join(', ')}`
              : 'the roster is empty; run `rowbly assignees add`',
        },
      );
    }
    return resolved;
  }

  function resolveMe(handle: string): string {
    if (handle !== 'me') return handle;
    if (!ctx.me) throw new UsageError('Me is not set', { hint: 'run `rowbly whoami <handle>`' });
    return ctx.me;
  }

  async function checkEpic(epicId: Slug): Promise<void> {
    try {
      await repos.epics.get(epicId);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const valid = (await repos.epics.list()).map((e) => e.id);
      throw new ValidationError(`unknown Epic "${epicId}"`, {
        details: { issues: [{ path: ['epicId'], message: `unknown Epic "${epicId}"` }], validEpics: valid },
      });
    }
  }

  async function createdBy(): Promise<Slug | null> {
    if (!ctx.me) return null;
    const roster = (await repos.rootConfig.get()).assignees;
    return roster.some((a) => a.handle === ctx.me) ? ctx.me : null;
  }

  /** Writes a new Story under the next free key; if that key turns out to exist, re-scans once. */
  async function writeNew(boardId: Slug, prefix: string, build: (key: string) => Story): Promise<Story> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const key = formatStoryKey(prefix, (await repos.stories.maxNumber(boardId)) + 1);
      if (await storyExists(key)) continue;
      const story = build(key);
      await repos.stories.put(story);
      return story;
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
      const stories = await storiesInScope(boardId);
      const configs = new Map<string, EffectiveBoardConfig>();
      for (const story of stories) {
        if (!configs.has(story.boardId)) configs.set(story.boardId, await effective(story));
      }
      const stagesOf = (story: Story) => configs.get(story.boardId)?.stages ?? [];
      const matches = storyMatcher(filter, stagesOf, filter.assignees?.map(resolveMe));
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

    async create(boardId, input) {
      const config = await resolveCascade(ctx.root, boardId);
      const stage = input.stage ?? config.stages[0]?.key;
      if (stage === undefined) throw new ValidationError('the Board has no Stages');
      checkStage(config.stages, stage);
      const assignees = await checkAssignees(input.assignees ?? []);
      if (input.epicId) await checkEpic(input.epicId);
      const customFields = validateFieldValues(config.customFields, input.customFields ?? {}, {
        requireRequired: true,
      });
      const existing = await repos.stories.allInBoard(boardId);
      const rank = rankAfter(bottomRank(existing, stage));
      const now = toTimestamp(ctx.now());
      const author = await createdBy();
      return writeNew(boardId, config.board.keyPrefix, (key) =>
        parseStory({
          version: 1,
          key,
          boardId,
          name: input.name,
          description: input.description ?? '',
          stage,
          rank,
          assignees,
          epicId: input.epicId ?? null,
          priority: input.priority ?? null,
          labels: unique(input.labels ?? []),
          dueDate: input.dueDate ?? null,
          customFields,
          createdBy: author,
          createdAt: now,
          updatedAt: now,
          nextTaskNumber: 1,
          tasks: [],
          comments: [],
        }),
      );
    },

    async update(key, patch) {
      const story = await repos.stories.findByKey(key);
      checkListPatch('assignees', patch.assignees, patch.addAssignees, patch.removeAssignees);
      checkListPatch('labels', patch.labels, patch.addLabels, patch.removeLabels);
      const next: Story = { ...story };
      if (patch.name !== undefined) next.name = patch.name;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.assignees !== undefined) {
        next.assignees = await checkAssignees(patch.assignees);
      } else if (patch.addAssignees || patch.removeAssignees) {
        const added = await checkAssignees(patch.addAssignees ?? []);
        const removed = (patch.removeAssignees ?? []).map(resolveMe);
        next.assignees = unique([...story.assignees, ...added]).filter((h) => !removed.includes(h));
      }
      if (patch.epicId !== undefined) {
        if (patch.epicId !== null) await checkEpic(patch.epicId);
        next.epicId = patch.epicId;
      }
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
      next.updatedAt = toTimestamp(ctx.now());
      const parsed = parseStory(next);
      await repos.stories.put(parsed);
      return parsed;
    },

    async move(key, stage, opts = {}) {
      const story = await repos.stories.findByKey(key);
      checkStage((await effective(story)).stages, stage);
      const others = (await repos.stories.allInBoard(story.boardId)).filter((s) => s.key !== story.key);
      const rank = opts.top ? rankBefore(topRank(others, stage)) : rankAfter(bottomRank(others, stage));
      return save({ ...story, stage, rank });
    },

    async rank(key, position) {
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
      return save({ ...story, rank });
    },

    async remove(key) {
      const story = await repos.stories.findByKey(key);
      await repos.stories.delete(story.boardId, story.key);
    },

    async labelsInUse(boardId) {
      const labels = (await repos.stories.allInBoard(boardId)).flatMap((s) => s.labels);
      return [...new Set(labels)].sort();
    },
  };

  async function save(story: Story): Promise<Story> {
    const next = { ...story, updatedAt: toTimestamp(ctx.now()) };
    await repos.stories.put(next);
    return next;
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
  assignees: Assignee[];
  /** Open Epics. */
  epics: Epic[];
  /** Labels already used on the Board. */
  labels: string[];
}

export async function storyChoices(ctx: RowblyContext, boardId: Slug): Promise<StoryChoices> {
  const repos = createRepositories(ctx.root);
  const [config, root, epics, labels] = await Promise.all([
    resolveCascade(ctx.root, boardId),
    repos.rootConfig.get(),
    repos.epics.list(),
    createStoriesService(ctx, repos).labelsInUse(boardId),
  ]);
  return { ...config, assignees: root.assignees, epics: epics.filter((e) => !e.closed), labels };
}

/** Every given filter must match (contracts §5). */
function storyMatcher(
  filter: StoryFilter,
  stagesOf: (story: Story) => readonly Stage[],
  assignees: readonly string[] | undefined,
): (story: Story) => boolean {
  const search = filter.search?.toLowerCase();
  return (story) => {
    const category = stagesOf(story).find((s) => s.key === story.stage)?.category;
    if (filter.stages?.length && !filter.stages.includes(story.stage)) return false;
    if (filter.category && category !== filter.category) return false;
    if (filter.open && category === 'done') return false;
    if (assignees?.length && !story.assignees.some((h) => assignees.includes(h))) return false;
    if (filter.epicId !== undefined && story.epicId !== filter.epicId) return false;
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

function checkStage(stages: readonly Stage[], key: string): void {
  if (stages.some((s) => s.key === key)) return;
  const valid = stages.map((s) => s.key);
  throw new ValidationError(`unknown Stage "${key}"`, {
    details: { issues: [{ path: ['stage'], message: `unknown Stage "${key}"` }], validStages: valid },
    hint: `valid Stages: ${valid.join(', ')}`,
  });
}

/** `--assignee`/`--label` replace the list, so they cannot be combined with the add/remove flags. */
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
