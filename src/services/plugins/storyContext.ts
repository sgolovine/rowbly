import { errorMessage, PluginError } from '../../core';
import { coordinated } from '../coordination';
import type { RowblyContext, Services } from '../types';
import { currentScope } from './executionScope';
import { invokePlugin } from './invoke';
import type { PluginStoryContextSection, StoryContext } from './types';

/**
 * The Story `key` with the Story Context section of every Plugin that is on, in registry order
 * (ADR-0044). It reads one committed state and saves nothing. A Plugin that is enabled but did not
 * load, one whose `storyContext` throws or gives no valid section, and one that marks its section
 * unavailable are each listed in `incomplete`, so a partial context never reads as complete.
 */
export function readStoryContext(ctx: RowblyContext, services: Services, key: string): Promise<StoryContext> {
  // A section or a row that reads the whole context again would run every Plugin's part inside one.
  if (currentScope()?.stage === 'row') {
    return Promise.reject(new PluginError('A Story Context cannot be read while giving a section or a row'));
  }
  return coordinated(ctx.root, 'story-context', async () => {
    const story = await services.stories.get(key);
    const plugins: string[] = [];
    const sections: StoryContext['sections'] = [];
    const incomplete: StoryContext['incomplete'] = (ctx.plugins?.failures() ?? []).map((f) => ({
      plugin: f.id,
      reason: `failed to load: ${f.reason ?? 'unknown'}`,
    }));
    for (const { definition } of ctx.plugins?.active() ?? []) {
      const { id } = definition;
      plugins.push(id);
      if (!definition.storyContext) continue;
      try {
        const section = await invokePlugin({ plugin: id, stage: 'row' }, () =>
          // Each Plugin gets its own copy, so one cannot change the Story the next one reads.
          definition.storyContext?.(structuredClone(story), services.plugins.context(id)),
        );
        if (section === null || section === undefined) continue;
        if (!isSection(section)) throw new Error('gave a section without a title and text');
        sections.push({ plugin: id, ...section });
        if (section.unavailable) incomplete.push({ plugin: id, reason: section.unavailable });
      } catch (err) {
        // The Plugin's own message, as rows keep it.
        const cause = err instanceof PluginError && err.cause !== undefined ? err.cause : err;
        incomplete.push({ plugin: id, reason: errorMessage(cause) });
      }
    }
    incomplete.sort((a, b) => a.plugin.localeCompare(b.plugin));
    return { story, plugins, sections, incomplete };
  });
}

function isSection(value: unknown): value is PluginStoryContextSection {
  const section = value as Partial<PluginStoryContextSection>;
  return typeof section?.title === 'string' && section.title.trim() !== '' && typeof section.text === 'string';
}
