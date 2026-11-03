import { fuzzySearch } from '../../core';
import type { Story } from '../../schemas';
import { type EffectiveBoardConfig, invokePlugin, type Services } from '../../services';
import type { TuiPlugin } from '../hooks';

export interface StorySearchEntry {
  story: Story;
  boardName: string;
  fields: string[];
}

/** Keep fields separate so a subsequence cannot jump from one unrelated field to another. */
function fieldText(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(fieldText);
  if (typeof value === 'object') return Object.entries(value).flatMap(([key, v]) => [key, ...fieldText(v)]);
  return [String(value)];
}

export async function loadStorySearch(
  services: Services,
  plugins: readonly TuiPlugin[],
  boardId: string | null,
): Promise<StorySearchEntry[]> {
  const boards = await services.boards.list();
  const stories = await services.stories.list(boardId, {});
  // What a Plugin reads from its files, it reads once for every Story, outside the Data Root lock
  // (ADR-0052). A load that fails leaves its Plugin's text out of this search, never a Story.
  const loaded = await Promise.all(
    plugins.map(async ({ id, tui }) => {
      const load = tui.loadStorySearchText;
      if (!load) return undefined;
      try {
        return await invokePlugin({ plugin: id, stage: 'screen' }, () =>
          load({ stories: structuredClone(stories), plugin: services.plugins.context(id) }),
        );
      } catch {
        return undefined;
      }
    }),
  );
  const entries: StorySearchEntry[] = [];
  const configs = new Map<string, EffectiveBoardConfig>();
  // Read sequentially: the service coordinator serializes reads, so don't queue the whole Data Root.
  for (const story of stories) {
    const { plugins: _bags, ...core } = story;
    let config = configs.get(story.boardId);
    if (!config) {
      config = await services.config.effective(story.boardId);
      configs.set(story.boardId, config);
    }
    const boardName = boards.find((board) => board.id === story.boardId)?.name ?? story.boardId;
    const fields = Object.values(core).flatMap(fieldText);
    fields.push(boardName, config.stages.find((stage) => stage.key === story.stage)?.name ?? story.stage);
    for (const [at, { id, tui }] of plugins.entries()) {
      const text = loaded[at];
      if (text) {
        try {
          fields.push(...text(structuredClone(story)));
        } catch {
          // Its text is left out for this Story only.
        }
      }
      if (!tui.storySearchText) continue;
      try {
        fields.push(
          ...(await invokePlugin(
            { plugin: id, stage: 'screen' },
            () => tui.storySearchText?.({ story: structuredClone(story), plugin: services.plugins.context(id) }) ?? [],
          )),
        );
      } catch {
        // Unavailable related content must not hide the Story itself.
      }
    }
    entries.push({ story, boardName, fields: fields.map((text) => text.toLowerCase()) });
  }
  return entries;
}

export function findStories(entries: readonly StorySearchEntry[], query: string): StorySearchEntry[] {
  return fuzzySearch(
    entries,
    query,
    (entry) => entry.fields,
    (a, b) => a.story.key.localeCompare(b.story.key, undefined, { numeric: true }),
  );
}
