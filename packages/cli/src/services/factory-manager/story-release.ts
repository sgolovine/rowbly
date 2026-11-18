// The forced assignment of a Story, for the control command `release-story`.
import { hasUnstoppedAttempt, releaseStory } from "../factory-policy/factory-policy.js";
import { updateFactoryStateIfChanged } from "../factory-state/factory-state.js";
import { getStory, listStoryRefs, type Story, type StoryRef, storyUidField } from "../story/story.js";
import { listThreads } from "../thread/thread.js";
import { isActiveStatus, type Manager, notify, serial } from "./manager-state.js";
import { classifiedStages } from "./manager-status.js";

/** The result of a release. `released` is false when the release did not change the factory state. */
export interface StoryRelease {
  readonly storyId: string;
  readonly released: boolean;
}

/**
 * Forces the factory to evaluate a Story for a worker again, with the same result as a Stage round trip. The release
 * removes the parking, the user cancellation and the launch failures of the Story, resets its budget and marks its
 * last stopped attempt as a Stage departure. A Story that does not exist, that is not in a work Stage, or that has an
 * active worker gives a success with no change. The release does not change the Story file. It takes only the state
 * lock.
 */
export function releaseParkedStory(manager: Manager, storyId: string): Promise<StoryRelease> {
  return serial(manager, () => forceAssignment(manager, storyId));
}

async function forceAssignment(manager: Manager, storyId: string): Promise<StoryRelease> {
  const story = await getStory({ id: storyId }, manager.ctx).catch(() => undefined);

  if (!story || !(await isWorkStage(manager, story.stage)) || (await hasActiveThread(manager, story.id))) {
    return { storyId, released: false };
  }

  const ref: StoryRef = { id: story.id, ...storyUidField(story) };
  // A Story file that cannot be read does not stop the release. The match then uses only the released Story.
  const stories = await listStoryRefs(manager.ctx).catch(() => []);
  const released = await updateFactoryStateIfChanged(
    manager.paths.root,
    (state) => (hasUnstoppedAttempt(state, ref, stories) ? undefined : releaseStory(state, ref, stories)),
    manager.ctx,
  );

  if (released) {
    notify(manager);
  }

  return { storyId, released };
}

/** Tells if the Stage is enabled and has a work prompt. Only a work Stage gets workers. */
async function isWorkStage(manager: Manager, stage: Story["stage"]): Promise<boolean> {
  const stages = await classifiedStages(manager);

  return stages.some((candidate) => candidate.key === stage && candidate.enabled && candidate.promptClass === "work");
}

/** Tells if the Story has a worker Thread that is pending or running. */
async function hasActiveThread(manager: Manager, storyId: string): Promise<boolean> {
  const { threads } = await listThreads({ story: storyId, role: "worker" }, manager.ctx);

  return threads.some((thread) => isActiveStatus(thread.status));
}
