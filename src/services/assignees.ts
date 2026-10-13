import { ConflictError, NotFoundError, toTimestamp } from '../core';
import { type Assignee, AssigneeSchema, type WorkspaceConfig } from '../schemas';
import type { Repositories } from '../storage';
import type { AssigneesService, RowblyContext } from './types';
import { plural, validInput } from './workspaces';

export function createAssigneesService(ctx: RowblyContext, repos: Repositories): AssigneesService {
  async function save(workspace: WorkspaceConfig, assignees: Assignee[]): Promise<void> {
    await repos.workspaces.put({ ...workspace, assignees, updatedAt: toTimestamp(ctx.now()) });
  }

  function find(workspace: WorkspaceConfig, handle: string): Assignee {
    const assignee = workspace.assignees.find((a) => a.handle === handle);
    if (!assignee) throw new NotFoundError(`Assignee "${handle}" not found in Workspace "${workspace.id}"`);
    return assignee;
  }

  return {
    async list(ws) {
      return (await repos.workspaces.get(ws)).assignees;
    },

    async add(ws, input) {
      const workspace = await repos.workspaces.get(ws);
      const assignee = validInput(AssigneeSchema, 'Assignee', {
        handle: input.handle,
        name: input.name,
        ...(input.email ? { email: input.email } : {}),
      });
      if (workspace.assignees.some((a) => a.handle === assignee.handle)) {
        throw new ConflictError(`Assignee "${assignee.handle}" already exists in Workspace "${ws}"`);
      }
      await save(workspace, [...workspace.assignees, assignee]);
      return assignee;
    },

    async update(ws, handle, patch) {
      const workspace = await repos.workspaces.get(ws);
      const { email, ...current } = find(workspace, handle);
      const nextEmail = patch.email === undefined ? email : patch.email || undefined;
      const assignee = validInput(AssigneeSchema, 'Assignee', {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(nextEmail ? { email: nextEmail } : {}),
      });
      await save(
        workspace,
        workspace.assignees.map((a) => (a.handle === handle ? assignee : a)),
      );
      return assignee;
    },

    async remove(ws, handle) {
      const workspace = await repos.workspaces.get(ws);
      find(workspace, handle);
      await save(
        workspace,
        workspace.assignees.filter((a) => a.handle !== handle),
      );
      let storiesUpdated = 0;
      for (const board of await repos.boards.list(ws)) {
        for (const story of await repos.stories.allInBoard({ workspaceId: ws, boardId: board.id })) {
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
