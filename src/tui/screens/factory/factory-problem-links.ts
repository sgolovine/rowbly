import type { Story } from "../../../services/story/story.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import type { FactoryProblem } from "./factory-status.js";

/**
 * The Thread that a problem relates to. The `supervisor` attention entry relates to the supervisor Thread of
 * the status file. An attention entry with a Story relates to the newest Thread of that Story. Other problems
 * have no Thread. `threads` is in the order of `listThreads`, the oldest first.
 */
export function problemThread(
  problem: FactoryProblem,
  threads: readonly ThreadRecord[],
  supervisorThreadId: string | undefined,
): ThreadRecord | undefined {
  if (problem.kind !== "attention") {
    return undefined;
  }

  if (problem.attentionKey === "supervisor") {
    return supervisorThreadId === undefined ? undefined : threads.find((thread) => thread.id === supervisorThreadId);
  }

  if (problem.storyId === undefined) {
    return undefined;
  }

  return threads.findLast((thread) => thread.storyId === problem.storyId);
}

/** The Story that a problem names, if the board has it. */
export function problemStory(problem: FactoryProblem, stories: readonly Story[]): Story | undefined {
  return problem.storyId === undefined ? undefined : stories.find((story) => story.id === problem.storyId);
}
