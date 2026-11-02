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
    for (const { id, tui } of plugins) {
      if (!tui.storySearchText) continue;
      try {
        fields.push(
          ...(await invokePlugin(
            { plugin: id, stage: 'screen' },
            () => tui.storySearchText?.({ story, plugin: services.plugins.context(id) }) ?? [],
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

/** Exact and contiguous matches lead; otherwise prefer a compact, early subsequence. */
function matchScore(text: string, query: string): number {
  if (text === query) return 0;
  const contiguous = text.indexOf(query);
  if (contiguous >= 0) return 1 + contiguous / (text.length + 1);
  let position = -1;
  let first = 0;
  for (const [index, char] of [...query].entries()) {
    position = text.indexOf(char, position + 1);
    if (position < 0) return Number.POSITIVE_INFINITY;
    if (index === 0) first = position;
  }
  return 2 + (position - first + 1 - query.length) / Math.max(query.length, 1) + first / (text.length + 1);
}

export function findStories(entries: readonly StorySearchEntry[], query: string): StorySearchEntry[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...entries];
  return entries
    .map((entry) => ({
      entry,
      score: terms.reduce(
        (total, term) => total + Math.min(...entry.fields.map((field) => matchScore(field, term))),
        0,
      ),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (a, b) => a.score - b.score || a.entry.story.key.localeCompare(b.entry.story.key, undefined, { numeric: true }),
    )
    .map(({ entry }) => entry);
}
