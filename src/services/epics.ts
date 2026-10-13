import { ConflictError, toTimestamp, ValidationError } from '../core';
import { type Epic, EpicSchema, type Slug, type Stage, type Story } from '../schemas';
import { cascade, type Repositories } from '../storage';
import type { ConfigService, EpicPatch, EpicsService, EpicView, RowblyContext } from './types';

export function createEpicsService(ctx: RowblyContext, repos: Repositories): EpicsService {
  /** Every Story in the Data Root, each with its own Board's effective Stages. */
  async function allStories(): Promise<{ story: Story; stages: Stage[] }[]> {
    const [global, boards] = await Promise.all([repos.rootConfig.get(), repos.boards.list()]);
    const perBoard = await Promise.all(
      boards.map(async (board) => {
        const { stages } = cascade(global, board);
        const stories = await repos.stories.allInBoard(board.id);
        return stories.map((story) => ({ story, stages }));
      }),
    );
    return perBoard.flat();
  }

  /** Membership comes from each Story's `epicId` (ADR-0004); a Story in an unknown Stage is never done. */
  function toView(epic: Epic, all: { story: Story; stages: Stage[] }[]): EpicView {
    const members = all.filter(({ story }) => story.epicId === epic.id);
    const done = members.filter(({ story, stages }) => isDone(story, stages)).length;
    return { ...epic, stories: members.map(({ story }) => story), progress: { done, total: members.length } };
  }

  async function save(epic: Epic): Promise<Epic> {
    const parsed = EpicSchema.safeParse(epic);
    if (!parsed.success) {
      throw new ValidationError(`Epic "${epic.id}" is invalid`, { details: { issues: parsed.error.issues } });
    }
    await repos.epics.put(parsed.data);
    return parsed.data;
  }

  async function patch(id: Slug, changes: EpicPatch & { closed?: boolean }): Promise<Epic> {
    const epic = await repos.epics.get(id);
    return save({ ...epic, ...changes, updatedAt: toTimestamp(ctx.now()) });
  }

  return {
    async list(opts = {}) {
      const closed = opts.closed ?? false;
      const [epics, all] = await Promise.all([repos.epics.list(), allStories()]);
      return epics.filter((epic) => closed === 'all' || epic.closed === closed).map((epic) => toView(epic, all));
    },

    async get(id) {
      const [epic, all] = await Promise.all([repos.epics.get(id), allStories()]);
      return toView(epic, all);
    },

    async create(input) {
      if ((await repos.epics.list()).some((epic) => epic.id === input.id)) {
        throw new ConflictError(`Epic "${input.id}" already exists`);
      }
      const now = toTimestamp(ctx.now());
      return save({
        version: 1,
        id: input.id,
        name: input.name,
        description: input.description ?? '',
        closed: false,
        createdAt: now,
        updatedAt: now,
      });
    },

    update: (id, { name, description }) =>
      patch(id, {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      }),

    setClosed: (id, closed) => patch(id, { closed }),

    async remove(id) {
      await repos.epics.get(id);
      const linked = (await allStories()).map(({ story }) => story).filter((story) => story.epicId === id);
      const now = toTimestamp(ctx.now());
      // Unlink first, so an interrupted delete never leaves Stories pointing at a missing Epic.
      for (const story of linked) await repos.stories.put({ ...story, epicId: null, updatedAt: now });
      await repos.epics.delete(id);
      if (linked.length > 0) {
        ctx.warn(`unlinked ${linked.length} ${linked.length === 1 ? 'Story' : 'Stories'} from Epic "${id}"`);
      }
      return { storiesUnlinked: linked.length };
    },
  };
}

function isDone(story: Story, stages: Stage[]): boolean {
  return stages.find((stage) => stage.key === story.stage)?.category === 'done';
}

/** The effective Stages of every Board an Epic's Stories sit on, keyed by Board id, for stage badges. */
export async function stagesByBoard(config: ConfigService, view: EpicView): Promise<Map<Slug, Stage[]>> {
  const boardIds = [...new Set(view.stories.map((story) => story.boardId))];
  const entries = await Promise.all(
    boardIds.map(async (boardId) => [boardId, (await config.effective(boardId)).stages] as const),
  );
  return new Map(entries);
}

/** An Epic's Stories grouped by Board id, in Board order. */
export function storiesByBoard(stories: readonly Story[]): Map<Slug, Story[]> {
  const groups = new Map<Slug, Story[]>();
  for (const story of stories) groups.set(story.boardId, [...(groups.get(story.boardId) ?? []), story]);
  return groups;
}
