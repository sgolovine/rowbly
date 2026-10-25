import {
  ConflictError,
  NotFoundError,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginContext,
  type PluginReadContext,
  type PluginReadServices,
  type Stage,
  type Story,
  toTimestamp,
  UsageError,
  ValidationError,
} from '../../plugin-api';
import { type StoredTask, StoredTaskSchema, type Task, type TaskCreateInput, type TaskPatch, TasksBag } from './model';

/** A canonical Task Id: a Story Key, a dot and the Task's number, e.g. `WEB-42.3`. */
const TASK_ID_RE = /^([A-Z][A-Z0-9]{1,9}-[1-9][0-9]*)\.([1-9][0-9]*)$/;

/** Parses a case-insensitive Task Id: `parseTaskId('web-42.3')` → `{ id: 'WEB-42.3', storyKey: 'WEB-42', number: 3 }`. */
export function parseTaskId(input: string): { id: string; storyKey: string; number: number } {
  const id = input.trim().toUpperCase();
  const match = TASK_ID_RE.exec(id);
  if (!match) throw new UsageError(`invalid Task id "${input}"`, { hint: 'expected e.g. WEB-42.1' });
  const [, storyKey = '', number = ''] = match;
  return { id, storyKey, number: Number(number) };
}

function withId(storyKey: string, task: StoredTask): Task {
  return { id: `${storyKey}.${task.number}`, ...task };
}

/** The Tasks of `story` as stored, or `null` when its bag is invalid. For display: never shown as empty. */
export function storedTasks(plugin: PluginReadContext, story: Story): Task[] | null {
  const bag = plugin.inspectBag(story, TasksBag);
  if (bag.kind === 'invalid') return null;
  return bag.kind === 'valid' ? bag.value.tasks.map((t) => withId(story.key, t)) : [];
}

/** The bag of `story`, to change it: an invalid bag throws `DataIntegrityError` instead of being replaced. */
function requireTasks(plugin: PluginReadContext, story: Story): TasksBag {
  return plugin.requireBag(story, TasksBag) ?? { nextNumber: 1, tasks: [] };
}

/** How many of `tasks` are in a Stage of Stage Category `done`. */
export function doneCount(tasks: readonly Pick<Task, 'stage'>[], stages: readonly Stage[]): number {
  return tasks.filter((t) => stages.find((s) => s.key === t.stage)?.category === 'done').length;
}

/** The effective Stages of `story`'s Board. */
export async function stagesOf(
  plugin: { services: Pick<PluginReadServices, 'config'> },
  story: Pick<Story, 'boardId'>,
): Promise<Stage[]> {
  return (await plugin.services.config.effective(story.boardId)).stages;
}

/** The Tasks of Story `storyKey` in creation order; an invalid bag throws `DataIntegrityError`. */
export async function listTasks(plugin: PluginContext, storyKey: string): Promise<Task[]> {
  const story = await plugin.services.stories.get(storyKey);
  return requireTasks(plugin, story).tasks.map((t) => withId(story.key, t));
}

/** The Story and the Task with a case-insensitive Task Id. */
export async function getTask(plugin: PluginContext, taskId: string): Promise<{ story: Story; task: Task }> {
  const { id, storyKey, number } = parseTaskId(taskId);
  const story = await plugin.services.stories.get(storyKey);
  const task = requireTasks(plugin, story).tasks.find((t) => t.number === number);
  if (!task) throw new NotFoundError(`Task ${id} not found`, { hint: `run \`rowbly tasks list ${story.key}\`` });
  return { story, task: withId(story.key, task) };
}

export function createTask(plugin: PluginContext, storyKey: string, input: TaskCreateInput): Promise<Task> {
  let key = storyKey;
  return plugin.operation(
    'create',
    { storyKey, ...input },
    async (changes) => {
      const story = await plugin.services.stories.get(storyKey);
      key = story.key;
      const stages = await stagesOf(plugin, story);
      const stage = input.stage ?? stages[0]?.key;
      if (stage === undefined) throw new ValidationError('the Board has no Stages');
      checkStage(stages, stage);
      const now = toTimestamp(plugin.now());
      let created: StoredTask | undefined;
      await updateTasks(plugin, changes, story.key, (bag) => {
        created = parseTask({
          number: bag.nextNumber,
          name: input.name,
          description: input.description ?? '',
          stage,
          createdAt: now,
          updatedAt: now,
        });
        return { nextNumber: bag.nextNumber + 1, tasks: [...bag.tasks, created] };
      });
      return withId(story.key, created as StoredTask);
    },
    { result: (changes, task) => saved(plugin, changes, key, task.number) },
  );
}

export function updateTask(plugin: PluginContext, taskId: string, patch: TaskPatch): Promise<Task> {
  const { storyKey, number } = parseTaskId(taskId);
  return plugin.operation(
    'update',
    { taskId, ...patch },
    async (changes) => {
      const { story, task } = await getTask(plugin, taskId);
      // A new Stage is the same change `move` makes, in this one operation (ARCH-43).
      if (patch.stage != null && patch.stage !== task.stage) checkStage(await stagesOf(plugin, story), patch.stage);
      return replaceTask(plugin, changes, story, number, (t) => ({
        ...t,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.stage != null ? { stage: patch.stage } : {}),
      }));
    },
    { result: (changes) => saved(plugin, changes, storyKey, number) },
  );
}

export function moveTask(plugin: PluginContext, taskId: string, stage: string): Promise<Task> {
  const { storyKey, number } = parseTaskId(taskId);
  return plugin.operation(
    'move',
    { taskId, stage },
    async (changes) => {
      const { story } = await getTask(plugin, taskId);
      checkStage(await stagesOf(plugin, story), stage);
      return replaceTask(plugin, changes, story, number, (t) => ({ ...t, stage }));
    },
    { result: (changes) => saved(plugin, changes, storyKey, number) },
  );
}

export function deleteTask(plugin: PluginContext, taskId: string): Promise<{ deleted: string }> {
  return plugin.operation('remove', { taskId }, async (changes) => {
    const { story, task } = await getTask(plugin, taskId);
    await updateTasks(plugin, changes, story.key, (bag) => ({
      ...bag,
      tasks: bag.tasks.filter((t) => t.number !== task.number),
    }));
    return { deleted: task.id };
  });
}

/** Replaces Task `number` of `story` with `update`'s result, stamping its `updatedAt`. */
async function replaceTask(
  plugin: PluginContext,
  changes: PluginChangeSet,
  story: Story,
  number: number,
  update: (task: StoredTask) => StoredTask,
): Promise<Task> {
  const updatedAt = toTimestamp(plugin.now());
  let next: StoredTask | undefined;
  await updateTasks(plugin, changes, story.key, (bag) => ({
    ...bag,
    tasks: bag.tasks.map((t) => {
      if (t.number !== number) return t;
      next = parseTask({ ...update(t), updatedAt });
      return next;
    }),
  }));
  if (!next) throw new NotFoundError(`Task ${story.key}.${number} not found`);
  return withId(story.key, next);
}

/**
 * Changes the pending bag of Story `key` with `update`, stamping the Story's `updatedAt`. The bag is
 * read strictly, so an invalid one rejects the operation before anything is saved.
 */
export async function updateTasks(
  plugin: PluginReadContext,
  changes: PluginChangeSet,
  key: string,
  update: (bag: TasksBag) => TasksBag,
): Promise<void> {
  const updatedAt = toTimestamp(plugin.now());
  await changes.updateStory(key, (story) => ({
    ...plugin.writeBag(story, update(requireTasks(plugin, story))),
    updatedAt,
  }));
}

/**
 * Task `number` of Story `key` as the pending Change Set holds it after every transform (ARCH-42). A
 * transform that removed it fails the operation before the save.
 */
function saved(plugin: PluginContext, changes: PluginChangeSetView, key: string, number: number): Task {
  const story = changes.story(key)?.after;
  const task = story && plugin.requireBag(story, TasksBag)?.tasks.find((t) => t.number === number);
  if (story && task) return withId(story.key, task);
  throw new ConflictError(`Task ${key}.${number} was removed before it was saved`, {
    hint: 'a transform of another Plugin removed it; see `rowbly plugins list`',
  });
}

/** Throws unless `key` is one of the Board's Stages. */
export function checkStage(stages: readonly Stage[], key: string): void {
  if (stages.some((s) => s.key === key)) return;
  const valid = stages.map((s) => s.key);
  throw new ValidationError(`unknown Stage "${key}"`, {
    details: { issues: [{ path: ['stage'], message: `unknown Stage "${key}"` }], validStages: valid },
    hint: `valid Stages: ${valid.join(', ')}`,
  });
}

function parseTask(input: StoredTask): StoredTask {
  const result = StoredTaskSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  const summary = issues.map((issue) => `${issue.path.join('.') || 'task'}: ${issue.message}`).join('; ');
  throw new ValidationError(`invalid Task: ${summary}`, { details: { issues } });
}
