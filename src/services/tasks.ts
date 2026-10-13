import { formatTaskId, NotFoundError, parseTaskId, toTimestamp, ValidationError } from '../core';
import { type Stage, type Story, type Task, TaskSchema } from '../schemas';
import { type Repositories, resolveCascade } from '../storage';
import type { CoreChangeSet } from './plugins/changeSet';
import { latestTask, type OperationRunner } from './plugins/runtime';
import type { RowblyContext, TasksService } from './types';

export function createTasksService(ctx: RowblyContext, repos: Repositories, ops: OperationRunner): TasksService {
  const stagesOf = async (story: Story) => (await resolveCascade(ctx.root, story.boardId)).stages;

  /** Replaces the Task in its Story, stamping both `updatedAt`s, and puts the Story in the Change Set. */
  async function save(changes: CoreChangeSet, story: Story, task: Task): Promise<Task> {
    const now = toTimestamp(ctx.now());
    const next = parseTask({ ...task, updatedAt: now });
    await changes.putStory({
      ...story,
      updatedAt: now,
      tasks: story.tasks.map((t) => (t.id === next.id ? next : t)),
    });
    return next;
  }

  return {
    list: async (storyKey) => (await repos.stories.findByKey(storyKey)).tasks,

    get: (taskId) => findTask(repos, taskId),

    create: (storyKey, input) =>
      ops.run(
        'tasks.create',
        { storyKey, ...input },
        async (changes) => {
          const story = await repos.stories.findByKey(storyKey);
          const stages = await stagesOf(story);
          const stage = input.stage ?? stages[0]?.key;
          if (stage === undefined) throw new ValidationError('the Board has no Stages');
          checkStage(stages, stage);
          const now = toTimestamp(ctx.now());
          const task = parseTask({
            id: formatTaskId(story.key, story.nextTaskNumber),
            name: input.name,
            description: input.description ?? '',
            stage,
            comments: [],
            createdAt: now,
            updatedAt: now,
          });
          await changes.putStory({
            ...story,
            updatedAt: now,
            nextTaskNumber: story.nextTaskNumber + 1,
            tasks: [...story.tasks, task],
          });
          return task;
        },
        latestTask,
      ),

    update: (taskId, patch) =>
      ops.run(
        'tasks.update',
        { taskId, ...patch },
        async (changes) => {
          const { story, task } = await findTask(repos, taskId);
          const next = { ...task };
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.description !== undefined) next.description = patch.description;
          return save(changes, story, next);
        },
        latestTask,
      ),

    move: (taskId, stage, opts = {}) =>
      ops.run(
        'tasks.move',
        { taskId, stage, ...opts },
        async (changes) => {
          const { story, task } = await findTask(repos, taskId);
          checkStage(await stagesOf(story), stage);
          return save(changes, story, { ...task, stage });
        },
        latestTask,
      ),

    remove: (taskId, opts = {}) =>
      ops.run('tasks.remove', { taskId, ...opts }, async (changes) => {
        const { story, task } = await findTask(repos, taskId);
        await changes.putStory({
          ...story,
          updatedAt: toTimestamp(ctx.now()),
          tasks: story.tasks.filter((t) => t.id !== task.id),
        });
      }),
  };
}

/** The Story and the Task with a case-insensitive Task id. */
export async function findTask(repos: Repositories, taskId: string): Promise<{ story: Story; task: Task }> {
  const { id, storyKey } = parseTaskId(taskId);
  const story = await repos.stories.findByKey(storyKey);
  const task = story.tasks.find((t) => t.id === id);
  if (!task) throw new NotFoundError(`Task ${id} not found`, { hint: `run \`rowbly tasks list ${story.key}\`` });
  return { story, task };
}

function checkStage(stages: readonly Stage[], key: string): void {
  if (stages.some((s) => s.key === key)) return;
  const valid = stages.map((s) => s.key);
  throw new ValidationError(`unknown Stage "${key}"`, {
    details: { issues: [{ path: ['stage'], message: `unknown Stage "${key}"` }], validStages: valid },
    hint: `valid Stages: ${valid.join(', ')}`,
  });
}

function parseTask(input: Task): Task {
  const result = TaskSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  const summary = issues.map((issue) => `${issue.path.join('.') || 'task'}: ${issue.message}`).join('; ');
  throw new ValidationError(`invalid Task: ${summary}`, { details: { issues } });
}
