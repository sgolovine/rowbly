import {
  type Bagged,
  NotFoundError,
  type PluginChangeSet,
  type PluginContext,
  type PluginFinding,
  type PluginHookContext,
  type PluginReadContext,
  parseStoryKey,
  type Story,
  toTimestamp,
  ValidationError,
} from '../../plugin-api';
import { type LinkPair, LinksBag, type LinkView, type StoryLink } from './model';

/** Strict reads before mutations never replace malformed or unknown Plugin Data. */
function requireBlocks(plugin: PluginReadContext, story: Bagged): string[] {
  return plugin.requireBag(story, LinksBag)?.blocks ?? [];
}

/** Known relationships plus the Stories whose invalid bags prevent a complete view. */
export async function readLinks(plugin: PluginContext, target: string): Promise<LinkView> {
  const story = await plugin.services.stories.get(target);
  return viewOf(plugin, story, await plugin.services.stories.list(story.boardId, {}));
}

/** CLI inspection fails explicitly if any same-Board bag could conceal relationships. */
export async function listLinks(plugin: PluginContext, target: string): Promise<StoryLink[]> {
  const story = await plugin.services.stories.get(target);
  const stories = await plugin.services.stories.list(story.boardId, {});
  for (const candidate of stories) requireBlocks(plugin, candidate);
  return viewOf(plugin, story, stories).links;
}

function viewOf(plugin: PluginReadContext, story: Story, stories: readonly Story[]): LinkView {
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const links: StoryLink[] = [];
  const unavailable: string[] = [];
  for (const candidate of stories) {
    const bag = plugin.inspectBag(candidate, LinksBag);
    if (bag.kind === 'invalid') {
      unavailable.push(candidate.key);
      continue;
    }
    const blocks = [...new Set(bag.kind === 'valid' ? bag.value.blocks : [])].sort();
    if (candidate.key === story.key) {
      for (const key of blocks) {
        const linked = byKey.get(key);
        links.push({ relation: 'blocks', key, name: linked?.name ?? null, available: Boolean(linked) });
      }
    } else if (blocks.includes(story.key)) {
      links.push({ relation: 'blocked-by', key: candidate.key, name: candidate.name, available: true });
    }
  }
  links.sort((a, b) => a.relation.localeCompare(b.relation) || a.key.localeCompare(b.key));
  return { links, unavailable };
}

/** Adds a canonical directed relationship; duplicate adds leave the data unchanged. */
export function addLink(plugin: PluginContext, blocker: string, blocked: string): Promise<LinkPair> {
  const pair = { blocker: parseStoryKey(blocker).key, blocked: parseStoryKey(blocked).key };
  return plugin.operation('add', pair, async (changes) => {
    const source = await plugin.services.stories.get(pair.blocker);
    const destination = await plugin.services.stories.get(pair.blocked);
    if (source.boardId !== destination.boardId) throw new ValidationError('linked Stories must be on the same Board');
    if (source.key === destination.key) throw new ValidationError('a Story cannot block itself');
    const blocks = requireBlocks(plugin, source);
    if (!blocks.includes(destination.key)) await setBlocks(plugin, changes, source.key, [...blocks, destination.key]);
    return pair;
  });
}

/** Removes an edge from its blocker, including one whose target no longer exists. */
export function removeLink(plugin: PluginContext, blocker: string, blocked: string): Promise<LinkPair> {
  const pair = { blocker: parseStoryKey(blocker).key, blocked: parseStoryKey(blocked).key };
  return plugin.operation('remove', pair, async (changes) => {
    const source = await plugin.services.stories.get(pair.blocker);
    const blocks = requireBlocks(plugin, source);
    if (!blocks.includes(pair.blocked)) {
      throw new NotFoundError(`${pair.blocker} does not block ${pair.blocked}`);
    }
    await setBlocks(
      plugin,
      changes,
      source.key,
      blocks.filter((key) => key !== pair.blocked),
    );
    return pair;
  });
}

/** Updates only this Plugin's bag, preserving every other Plugin's data in the pending record. */
async function setBlocks(
  plugin: PluginReadContext,
  changes: PluginChangeSet,
  key: string,
  blocks: readonly string[],
): Promise<void> {
  await changes.updateStory(key, (story) => {
    requireBlocks(plugin, story);
    const next = [...new Set(blocks)].sort();
    return {
      ...plugin.writeBag(story, next.length ? { blocks: next } : undefined),
      updatedAt: toTimestamp(plugin.now()),
    };
  });
}

/** Deletion and all incoming-reference cleanup are saved in the same Change Set. */
export async function unlinkDeleted(changes: PluginChangeSet, plugin: PluginHookContext): Promise<void> {
  const deleted = changes.changes.flatMap((change) =>
    change.type === 'story' && change.before && !change.after ? [change.before] : [],
  );
  for (const removed of deleted) {
    for (const stored of await plugin.services.stories.list(removed.boardId, {})) {
      const pending = changes.story(stored.key);
      if (pending && !pending.after) continue;
      const story = pending?.after ?? stored;
      const blocks = requireBlocks(plugin, story);
      if (blocks.includes(removed.key)) {
        await setBlocks(
          plugin,
          changes,
          story.key,
          blocks.filter((key) => key !== removed.key),
        );
      }
    }
  }
}

/** Invalid bags are left to the host's PLUGIN_DATA_INVALID finding, never repaired as empty. */
export function checkLinks(plugin: PluginReadContext, stories: readonly Story[]): PluginFinding[] {
  const byKey = new Map(stories.map((story) => [story.key, story]));
  return stories.flatMap((story) => {
    const bag = plugin.inspectBag(story, LinksBag);
    if (bag.kind !== 'valid') return [];
    const stale = [...new Set(bag.value.blocks)].filter((key) => {
      const target = byKey.get(key);
      return !target || target.boardId !== story.boardId || target.key === story.key;
    });
    if (!stale.length) return [];
    return [
      {
        code: 'INVALID_TARGET',
        severity: 'warning',
        path: `boards/${story.boardId}/stories/${story.key}/story.json`,
        message: `${story.key} has missing, cross-Board or self links: ${stale.join(', ')}`,
        details: { keys: stale },
        async fix(changes: PluginChangeSet) {
          await changes.updateStory(story.key, (current) => {
            const blocks = requireBlocks(plugin, current).filter((key) => !stale.includes(key));
            return {
              ...plugin.writeBag(current, blocks.length ? { blocks } : undefined),
              updatedAt: toTimestamp(plugin.now()),
            };
          });
          return `removed invalid Story links from ${story.key}`;
        },
      } satisfies PluginFinding,
    ];
  });
}
