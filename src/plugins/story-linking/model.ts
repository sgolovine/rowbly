import { StoryKeySchema, z } from '../../plugin-api';

/** Each relationship lives once, on the Story that blocks; incoming links are derived. */
export const LinksBag = z.strictObject({ blocks: z.array(StoryKeySchema) });

export type LinkDirection = 'blocks' | 'blocked-by';

/** A relationship relative to the Story being inspected. */
export interface StoryLink {
  relation: LinkDirection;
  key: string;
  name: string | null;
  available: boolean;
}

export interface LinkView {
  links: StoryLink[];
  /** Invalid bags may conceal incoming links; never present the partial view as complete. */
  unavailable: string[];
}

export interface LinkPair {
  blocker: string;
  blocked: string;
}

export function directionLabel(direction: LinkDirection): string {
  return direction === 'blocks' ? 'Blocks' : 'Blocked by';
}
