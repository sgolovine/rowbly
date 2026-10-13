import type { ZodType } from 'zod';
import { ConflictError, toTimestamp, ValidationError } from '../core';
import { type Slug, type WorkspaceConfig, WorkspaceConfigSchema } from '../schemas';
import { createRepositories, type Repositories } from '../storage';
import type { RowblyContext, WorkspacesService } from './types';

/** Configuration Cascade levels that define their own list. */
export interface OverrideLevels {
  global: boolean;
  workspace: boolean;
  /** Boards in the Workspace with their own list. */
  boards: Slug[];
}

/** What `workspaces show` prints: the Workspace, what it holds and where Stages and Custom Fields are defined. */
export interface WorkspaceOverview {
  workspace: WorkspaceConfig;
  boards: number;
  epics: number;
  assignees: number;
  overrides: { stages: OverrideLevels; customFields: OverrideLevels };
}

/**
 * Summarises a Workspace. Lives beside the service rather than on it because the frozen
 * `WorkspacesService` contract has no such method.
 */
export async function workspaceOverview(ctx: RowblyContext, id: Slug): Promise<WorkspaceOverview> {
  const repos = createRepositories(ctx.root);
  const workspace = await repos.workspaces.get(id);
  const [boards, epics, global] = await Promise.all([
    repos.boards.list(id),
    repos.epics.list(id),
    repos.rootConfig.get(),
  ]);
  const levels = (key: 'stages' | 'customFields'): OverrideLevels => ({
    global: global[key] !== undefined,
    workspace: workspace[key] !== undefined,
    boards: boards.filter((board) => board[key] !== undefined).map((board) => board.id),
  });
  return {
    workspace,
    boards: boards.length,
    epics: epics.length,
    assignees: workspace.assignees.length,
    overrides: { stages: levels('stages'), customFields: levels('customFields') },
  };
}

/** Contracts §7: a Workspace with Boards or Epics is deleted only with `force`. */
export function assertWorkspaceRemovable(id: Slug, contents: { boards: number; epics: number }, force: boolean): void {
  if (force || (contents.boards === 0 && contents.epics === 0)) return;
  throw new ConflictError(
    `Workspace "${id}" is not empty (${plural(contents.boards, 'Board')}, ${plural(contents.epics, 'Epic')})`,
    { hint: 'pass --force to delete it with everything inside' },
  );
}

export function createWorkspacesService(ctx: RowblyContext, repos: Repositories): WorkspacesService {
  return {
    list: () => repos.workspaces.list(),

    get: (id) => repos.workspaces.get(id),

    async create(input) {
      const now = toTimestamp(ctx.now());
      const workspace = validInput(WorkspaceConfigSchema, 'Workspace', {
        version: 1,
        id: input.id,
        name: input.name,
        description: input.description ?? '',
        assignees: [],
        createdAt: now,
        updatedAt: now,
      });
      const existing = await repos.workspaces.list();
      if (existing.some((ws) => ws.id === workspace.id)) {
        throw new ConflictError(`Workspace "${workspace.id}" already exists`);
      }
      await repos.workspaces.put(workspace);
      return workspace;
    },

    async update(id, patch) {
      const current = await repos.workspaces.get(id);
      const workspace = validInput(WorkspaceConfigSchema, 'Workspace', {
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: toTimestamp(ctx.now()),
      });
      await repos.workspaces.put(workspace);
      return workspace;
    },

    async remove(id, { force }) {
      const workspace = await repos.workspaces.get(id);
      const [boards, epics] = await Promise.all([repos.boards.list(id), repos.epics.list(id)]);
      assertWorkspaceRemovable(workspace.id, { boards: boards.length, epics: epics.length }, force);
      await repos.workspaces.delete(workspace.id);
      if (ctx.local.workspace === workspace.id) {
        const { workspace: _w, board: _b, ...rest } = ctx.local;
        await repos.localState.put(rest);
        ctx.local = rest;
      }
    },
  };
}

/** Parses service input with `schema`; a failure is a `ValidationError` carrying the zod issues. */
export function validInput<T>(schema: ZodType<T>, what: string, value: T): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const [first] = result.error.issues;
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  throw new ValidationError(`invalid ${what}: ${where}${first?.message ?? 'invalid input'}`, {
    details: { issues: result.error.issues },
  });
}

/** `plural(1, 'story')` → `1 story`; `plural(2, 'story')` → `2 stories`. */
export function plural(n: number, noun: string): string {
  if (n === 1) return `${n} ${noun}`;
  return `${n} ${noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}
