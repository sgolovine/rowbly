import {
  ConflictError,
  type DeepReadonly,
  type PluginChangeSetView,
  type PluginHookContext,
  type Story,
  StoryKeySchema,
  z,
} from '../../plugin-api';
import { LinksBag } from './model';

/** Recheck the complete pending state after transforms, while start still holds the Data Root lock. */
export async function guardFactoryStart(
  plugin: PluginHookContext,
  changes: PluginChangeSetView,
  result: unknown,
): Promise<undefined> {
  const { key } = z.object({ key: StoryKeySchema }).parse(result);
  const stored = await plugin.services.stories.get(key);
  const story = changes.story(key)?.after ?? stored;
  const stories = new Map<string, DeepReadonly<Story>>(
    (await plugin.services.stories.list(story.boardId, {})).map((s) => [s.key, s]),
  );
  for (const change of changes.changes) {
    if (change.type !== 'story') continue;
    if (change.before) stories.delete(change.before.key);
    if (change.after?.boardId === story.boardId) stories.set(change.after.key, change.after);
  }
  const { stages } = await plugin.services.config.effective(story.boardId);
  const blockers = [...stories.values()]
    .filter((candidate) => {
      const blocks = plugin.requireBag(candidate, LinksBag)?.blocks ?? [];
      return blocks.includes(story.key) && stages.find((s) => s.key === candidate.stage)?.category !== 'done';
    })
    .map(({ key, name, stage }) => ({ key, name, stage }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (!blockers.length) return;
  const message = `Blocked by ${blockers.map((s) => s.key).join(', ')}`;
  throw new ConflictError(`${story.key}: ${message}`, {
    details: { key: story.key, eligibility: { eligible: false, reasons: [{ code: 'BLOCKED', message, blockers }] } },
  });
}
