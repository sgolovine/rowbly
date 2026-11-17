// The release of a parked Story, for the control command `release`.
import { releaseStory } from "../factory-policy/factory-policy.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { getStory, listStoryRefs, type StoryRef, storyUidField } from "../story/story.js";
import { type Manager, notify, serial } from "./manager-state.js";

/** The result of a release. `released` is false for a Story that is not parked. */
export interface StoryRelease {
  readonly storyId: string;
  readonly released: boolean;
}

/**
 * Releases the policy parking of a Story, so that the next pass can start a worker for it. A Story that is not parked
 * gives a success with no change. The release takes only the state lock.
 */
export function releaseParkedStory(manager: Manager, storyId: string): Promise<StoryRelease> {
  return serial(manager, () => releaseIfParked(manager, storyId));
}

async function releaseIfParked(manager: Manager, storyId: string): Promise<StoryRelease> {
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  if (!state.parked?.[storyId]) {
    return { storyId, released: false };
  }

  const story = await storyRef(manager, storyId);
  // A Story file that cannot be read does not stop the release. The match then uses only the released Story.
  const stories = await listStoryRefs(manager.ctx).catch(() => []);

  await updateFactoryState(manager.paths.root, (current) => releaseStory(current, story, stories), manager.ctx);
  notify(manager);

  return { storyId, released: true };
}

/** The ID and the `uid` of the Story. A Story that cannot be read gives only the ID. */
function storyRef(manager: Manager, storyId: string): Promise<StoryRef> {
  return getStory({ id: storyId }, manager.ctx).then(
    (story) => ({ id: storyId, ...storyUidField(story) }),
    () => ({ id: storyId }),
  );
}
