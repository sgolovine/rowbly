import { ConflictError, NotFoundError, toTimestamp } from '../core';
import { type Assignee, AssigneeSchema, type RowblyConfig } from '../schemas';
import type { Repositories } from '../storage';
import { plural, validInput } from './_validate';
import type { AssigneesService, RowblyContext } from './types';

export function createAssigneesService(ctx: RowblyContext, repos: Repositories): AssigneesService {
  async function save(config: RowblyConfig, assignees: Assignee[]): Promise<void> {
    await repos.rootConfig.put({ ...config, assignees });
  }

  function find(config: RowblyConfig, handle: string): Assignee {
    const assignee = config.assignees.find((a) => a.handle === handle);
    if (!assignee) throw new NotFoundError(`Assignee "${handle}" not found`);
    return assignee;
  }

  return {
    async list() {
      return (await repos.rootConfig.get()).assignees;
    },

    async add(input) {
      const config = await repos.rootConfig.get();
      const assignee = validInput(AssigneeSchema, 'Assignee', {
        handle: input.handle,
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
      });
      if (config.assignees.some((a) => a.handle === assignee.handle)) {
        throw new ConflictError(`Assignee "${assignee.handle}" already exists`);
      }
      await save(config, [...config.assignees, assignee]);
      return assignee;
    },

    async update(handle, patch) {
      const config = await repos.rootConfig.get();
      const { email, ...current } = find(config, handle);
      const nextEmail = patch.email === undefined ? email : patch.email || undefined;
      const assignee = validInput(AssigneeSchema, 'Assignee', {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
      });
      await save(
        config,
        config.assignees.map((a) => (a.handle === handle ? assignee : a)),
      );
      return assignee;
    },

    async remove(handle) {
      const config = await repos.rootConfig.get();
      find(config, handle);
      await save(
        config,
        config.assignees.filter((a) => a.handle !== handle),
      );
      let storiesUpdated = 0;
      for (const board of await repos.boards.list()) {
        for (const story of await repos.stories.allInBoard(board.id)) {
          if (!story.assignees.includes(handle)) continue;
          await repos.stories.put({
            ...story,
            assignees: story.assignees.filter((h) => h !== handle),
            updatedAt: toTimestamp(ctx.now()),
          });
          storiesUpdated += 1;
        }
      }
      if (storiesUpdated > 0) ctx.warn(`Assignee "${handle}" removed from ${plural(storiesUpdated, 'story')}`);
      return { storiesUpdated };
    },
  };
}
