import {
  type Bagged,
  ConflictError,
  type DeepReadonly,
  NotFoundError,
  type PluginChangeSet,
  type PluginContext,
  type PluginReadContext,
  type Story,
  toTimestamp,
  UsageError,
  ValidationError,
} from '../../plugin-api';
import { type Assignee, AssigneePatch, AssigneeSchema, AssigneesBag, type AssigneesInput, validate } from './model';
import { pendingRoster, writeRoster } from './roster';

/** A Story's Assignees; none when it has no bag, or an invalid one. */
export function storyAssignees(plugin: PluginReadContext, story: Bagged): string[] {
  return plugin.readBag(story, AssigneesBag)?.assignees ?? [];
}

/** `handle`, or Me for the literal `me`; `UsageError` when Me is unset. */
export function resolveMe(plugin: PluginReadContext, handle: string): string {
  if (handle !== 'me') return handle;
  if (!plugin.me) throw new UsageError('Me is not set', { hint: 'run `rowbly whoami <handle>`' });
  return plugin.me;
}

function find(roster: readonly Assignee[], handle: string): Assignee {
  const assignee = roster.find((a) => a.handle === handle);
  if (!assignee) throw new NotFoundError(`Assignee "${handle}" not found`);
  return assignee;
}

export async function addAssignee(plugin: PluginContext, input: { handle: string; name: string; email?: string }) {
  const assignee = validate(
    AssigneeSchema,
    { handle: input.handle, name: input.name, ...(input.email ? { email: input.email } : {}) },
    'Assignee',
  );
  return plugin.operation('add', assignee, async (changes) => {
    const roster = await pendingRoster(changes);
    if (roster.some((a) => a.handle === assignee.handle)) {
      throw new ConflictError(`Assignee "${assignee.handle}" already exists`);
    }
    await writeRoster(changes, [...roster, assignee]);
    return assignee;
  });
}

export async function editAssignee(
  plugin: PluginContext,
  handle: string,
  input: { name?: string; email?: string | null },
) {
  const patch = validate(
    AssigneePatch,
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    'Assignee',
  );
  return plugin.operation('update', { handle, ...patch }, async (changes) => {
    const roster = await pendingRoster(changes);
    const { email, ...current } = find(roster, handle);
    const nextEmail = patch.email === undefined ? email : (patch.email ?? undefined);
    const updated: Assignee = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(nextEmail ? { email: nextEmail } : {}),
    };
    await writeRoster(
      changes,
      roster.map((a) => (a.handle === handle ? updated : a)),
    );
    return updated;
  });
}

/** Removes `handle` from the roster and from every Story, and warns with the number of Stories. */
export async function removeAssignee(plugin: PluginContext, handle: string) {
  const result = await plugin.operation('remove', { handle }, async (changes) => {
    const roster = await pendingRoster(changes);
    find(roster, handle);
    await writeRoster(
      changes,
      roster.filter((a) => a.handle !== handle),
    );
    let storiesUpdated = 0;
    for (const story of await plugin.services.stories.list(null, {})) {
      if (!storyAssignees(plugin, story).includes(handle)) continue;
      await changes.updateStory(story.key, (s) =>
        setAssignees(
          plugin,
          { ...s, updatedAt: toTimestamp(plugin.now()) },
          storyAssignees(plugin, s).filter((h) => h !== handle),
        ),
      );
      storiesUpdated += 1;
    }
    return { handle, storiesUpdated };
  });
  const n = result.storiesUpdated;
  if (n > 0) plugin.warn(`Assignee "${handle}" removed from ${n} ${n === 1 ? 'story' : 'stories'}`);
  return result;
}

/** `story` with `assignees` as its Assignees; no bag when there are none. */
export function setAssignees<S extends Story>(plugin: PluginReadContext, story: S, assignees: readonly string[]): S {
  return plugin.writeBag(story, assignees.length > 0 ? { assignees: [...assignees] } : undefined) as S;
}

/**
 * Applies this Plugin's input of `stories.create` or `stories.update` to Story `key`: `me` is Me,
 * duplicates go, and every added handle must be in the roster as this Change Set will save it.
 */
export async function applyInput(
  plugin: PluginReadContext,
  changes: PluginChangeSet,
  key: string,
  input: DeepReadonly<AssigneesInput> | undefined,
): Promise<void> {
  if (input === undefined) return;
  const added = unique([...(input.assignees ?? []), ...(input.add ?? [])].map((h) => resolveMe(plugin, h)));
  const removed = (input.remove ?? []).map((h) => resolveMe(plugin, h));
  const handles = (await pendingRoster(changes)).map((a) => a.handle);
  const unknown = added.filter((handle) => !handles.includes(handle));
  if (unknown.length > 0) {
    throw new ValidationError(
      `unknown Assignee${unknown.length > 1 ? 's' : ''} ${unknown.map((h) => `"${h}"`).join(', ')}`,
      {
        details: {
          issues: unknown.map((handle) => ({ path: ['assignees'], message: `unknown Assignee "${handle}"` })),
          validHandles: handles,
        },
        hint:
          handles.length > 0
            ? `valid handles: ${handles.join(', ')}`
            : 'the roster is empty; run `rowbly assignees add`',
      },
    );
  }
  await changes.updateStory(key, (story) => {
    // Adding to or removing from an invalid stored list throws rather than overwriting it.
    const base = input.assignees === undefined ? (plugin.requireBag(story, AssigneesBag)?.assignees ?? []) : [];
    return setAssignees(
      plugin,
      story,
      unique([...base, ...added]).filter((h) => !removed.includes(h)),
    );
  });
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
