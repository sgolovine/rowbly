import type { PluginContext, Story } from '../../plugin-api';
import { heldReason, readHold } from './holds';

export interface EligibilityReason {
  code: string;
  message: string;
  blockers?: { key: string; name: string; stage: string }[];
}

/** Launch restrictions, independent of the Story's current Stage Run. */
export interface Eligibility {
  eligible: boolean;
  reasons: EligibilityReason[];
}

/** Story Linking interprets its own data through its public Story filter. */
export async function storyEligibility(plugin: PluginContext, story: Story): Promise<Eligibility> {
  const reasons: EligibilityReason[] = [];
  // A hold this Rowbly cannot read counts as held (ADR-0043).
  const held = heldReason(await readHold(plugin, story.key));
  if (held) reasons.push(held);
  const global = await plugin.services.config.global();
  if (global.config.plugins?.['story-linking']?.enabled) {
    // A missing or failing enabled provider fails the query rather than treating it as no links.
    const blockers = (
      await plugin.services.stories.list(story.boardId, {
        open: true,
        plugins: { 'story-linking': { blocks: story.key } },
      })
    )
      .map(({ key, name, stage }) => ({ key, name, stage }))
      .sort((a, b) => a.key.localeCompare(b.key));
    if (blockers.length)
      reasons.push({ code: 'BLOCKED', message: `Blocked by ${blockers.map((s) => s.key).join(', ')}`, blockers });
  }
  return { eligible: reasons.length === 0, reasons };
}
