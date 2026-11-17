// The apply of one field entry: a compare-and-set for each change, then one Story write.

import type { OutboxEntry, StoryWrite } from "../outbox/outbox.js";
import { type Decision, decide, updateInput } from "../outbox/outbox-decision.js";
import { type Story, updateStory } from "../story/story.js";
import { type ApplyEnv, findStory, type OutboxConflict, rowblyProblem } from "./apply-state.js";

/** A field entry, with the values of the outbox. */
type FieldEntry = OutboxEntry & StoryWrite;

/** The reason of a conflict when the value on the main machine is not `before` or `after`. */
const DIFFERENT = "The value on the main machine is different";

function toConflict(env: ApplyEnv, entry: FieldEntry, decision: Decision): OutboxConflict {
  const { change } = decision;

  return {
    host: env.host,
    seq: entry.seq,
    storyId: entry.storyId,
    path: change.path,
    before: change.before,
    after: change.after,
    current: decision.current,
    reason: decision.reason,
  };
}

/** Writes the changes in one Story write. A refused write makes each of the changes a conflict. */
async function writeChanges(env: ApplyEnv, story: Story, writes: readonly Decision[]): Promise<Decision[]> {
  if (writes.length === 0) {
    return [];
  }

  try {
    await updateStory(
      updateInput(
        story.id,
        writes.map((decision) => decision.change),
      ),
      env.ctx,
    );

    return [];
  } catch (error) {
    const reason = rowblyProblem(error);

    return writes.map((decision) => ({ ...decision, action: "conflict", reason }));
  }
}

/**
 * Applies one field entry. It writes the changes that do not conflict in one Story write, and gives a conflict for
 * each other change. A missing Story makes each change a conflict.
 */
export async function applyFieldEntry(env: ApplyEnv, entry: FieldEntry): Promise<OutboxConflict[]> {
  const found = await findStory(env, entry);

  if (!found.story) {
    const reason = found.problem;

    return entry.changes.map((change) =>
      toConflict(env, entry, { change, action: "conflict", current: undefined, reason }),
    );
  }

  const { story } = found;
  const decisions = entry.changes.map((change) => decide(story, change, DIFFERENT));
  const refused = await writeChanges(
    env,
    story,
    decisions.filter((decision) => decision.action === "write"),
  );

  return [...decisions.filter((decision) => decision.action === "conflict"), ...refused].map((decision) =>
    toConflict(env, entry, decision),
  );
}
