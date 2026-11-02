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

export async function storyEligibility(plugin: PluginContext, story: Story): Promise<Eligibility> {
  const reasons: EligibilityReason[] = [];
  // A hold this Rowbly cannot read counts as held (ADR-0043).
  const held = heldReason(await readHold(plugin, story.key));
  if (held) reasons.push(held);
  return { eligible: reasons.length === 0, reasons };
}
