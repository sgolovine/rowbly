import { ConflictError, NotFoundError, toTimestamp } from '../core';
import { type Assignee, AssigneeSchema, type RowblyConfig } from '../schemas';
import type { Repositories } from '../storage';
import { plural, validInput } from './_validate';
import type { OperationRunner } from './plugins/runtime';
import type { ChangeSetView } from './plugins/types';
import type { AssigneesService, RowblyContext } from './types';

export function createAssigneesService(
  ctx: RowblyContext,
  repos: Repositories,
  ops: OperationRunner,
): AssigneesService {
  function find(config: RowblyConfig, handle: string): Assignee {
    const assignee = config.assignees.find((a) => a.handle === handle);
    if (!assignee) throw new NotFoundError(`Assignee "${handle}" not found`);
    return assignee;
  }

  return {
    async list() {
      return (await repos.rootConfig.get()).assignees;
    },

    add: (input) =>
      ops.run(
        'assignees.add',
        input,
        async (changes) => {
          const { plugins: _plugins, ...fields } = input;
          const assignee = validInput(AssigneeSchema, 'Assignee', {
            handle: fields.handle,
            name: fields.name,
            ...(fields.email ? { email: fields.email } : {}),
          });
          await changes.updateRootConfig((config) => {
            if (config.assignees.some((a) => a.handle === assignee.handle)) {
              throw new ConflictError(`Assignee "${assignee.handle}" already exists`);
            }
            return { ...config, assignees: [...config.assignees, assignee] };
          });
          return assignee;
        },
        latestAssignee,
      ),

    update: (handle, patch) =>
      ops.run(
        'assignees.update',
        { handle, ...patch },
        async (changes) => {
          let assignee: Assignee | undefined;
          await changes.updateRootConfig((config) => {
            const { email, ...current } = find(config, handle);
            const nextEmail = patch.email === undefined ? email : patch.email || undefined;
            const updated = validInput(AssigneeSchema, 'Assignee', {
              ...current,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(nextEmail ? { email: nextEmail } : {}),
            });
            assignee = updated;
            return { ...config, assignees: config.assignees.map((a) => (a.handle === handle ? updated : a)) };
          });
          return assignee as Assignee;
        },
        latestAssignee,
      ),

    async remove(handle, opts = {}) {
      const result = await ops.run('assignees.remove', { handle, ...opts }, async (changes) => {
        await changes.updateRootConfig((config) => {
          find(config, handle);
          return { ...config, assignees: config.assignees.filter((a) => a.handle !== handle) };
        });
        let storiesUpdated = 0;
        for (const board of await repos.boards.list()) {
          for (const story of await repos.stories.allInBoard(board.id)) {
            if (!story.assignees.includes(handle)) continue;
            await changes.putStory({
              ...story,
              assignees: story.assignees.filter((h) => h !== handle),
              updatedAt: toTimestamp(ctx.now()),
            });
            storiesUpdated += 1;
          }
        }
        return { storiesUpdated };
      });
      const n = result.storiesUpdated;
      if (n > 0) ctx.warn(`Assignee "${handle}" removed from ${plural(n, 'story')}`);
      return result;
    },
  };
}

/** The version of an Assignee that an operation saves, after every transform. */
function latestAssignee(changes: ChangeSetView, assignee: Assignee): Assignee {
  const root = changes.changes.find((c) => c.type === 'rootConfig');
  return root?.after.assignees.find((a) => a.handle === assignee.handle) ?? assignee;
}
