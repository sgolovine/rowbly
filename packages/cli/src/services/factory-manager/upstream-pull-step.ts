// The factory step that moves stuck upstream Stories out of the first Stage, when the setting is on.

import { pullUpstream } from "../factory-settings/factory-settings.js";
import { formatAuthor } from "../factory-settings/git-settings.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { commitProjectFiles } from "../project-write/project-commit.js";
import { projectWrite } from "../project-write/project-write.js";
import { searchStories, updateStory } from "../story/story.js";
import { getState, type Manager, serial } from "./manager-state.js";
import { classifiedStages } from "./manager-status.js";
import { pullMessage, type UpstreamPull, upstreamPull } from "./upstream-pull.js";

/** The commit statuses that are not a problem of this step. The commit step reports a Project without Git. */
const COMMIT_OK: readonly string[] = ["committed", "clean", "no-git"];

/**
 * Moves each stuck upstream Story in the first Stage to the first `work` Stage, and commits the moves.
 * It holds the Project write lock and not the state lock, so the lock order stays correct.
 * Gives an attention text when the commit has a problem.
 */
export async function pullUpstreamStories(manager: Manager): Promise<string | undefined> {
  // A running sync holds the write lock for a long time, so the move waits for a later pass.
  if (!pullUpstream(getState(manager).settings) || getState(manager).syncTask) {
    return undefined;
  }

  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const pull = upstreamPull(stories, stages, state.parked ?? {});

  if (!pull) {
    return undefined;
  }

  return serial(manager, () => projectWrite(manager.paths.root, () => moveStories(manager, pull)));
}

/** Moves the Stories, then commits them with a message that names the moved and the waiting Stories. */
async function moveStories(manager: Manager, pull: UpstreamPull): Promise<string | undefined> {
  await mapInOrder(pull.moves, (id) => updateStory({ id, stage: pull.to.key }, manager.ctx));

  const author = formatAuthor(getState(manager).settings.git);
  const committed = await commitProjectFiles(manager.paths.root, { message: pullMessage(pull), author });

  return COMMIT_OK.includes(committed.status) ? undefined : `Upstream move commit: ${committed.status}`;
}
