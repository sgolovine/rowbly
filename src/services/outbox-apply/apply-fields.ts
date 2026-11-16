// The apply of one field entry: a compare-and-set for each change, then one Story write.

import type { FieldChange, OutboxEntry, StoryWrite } from "../outbox/outbox.js";
import { type ChangeAction, compareChange, storyValue } from "../outbox/outbox-compare.js";
import { type Story, type UpdateStoryInput, updateStory } from "../story/story.js";
import { type ApplyEnv, findStory, type OutboxConflict, rowblyProblem } from "./apply-state.js";

/** A field entry, with the values of the outbox. */
type FieldEntry = OutboxEntry & StoryWrite;

/** The decision for one change. */
interface Decision {
  readonly change: FieldChange;
  readonly action: ChangeAction;
  readonly current: unknown;
  readonly reason: string;
}

const FIELD_PREFIX = "fields.";
const TEXT_PATHS = ["title", "stage", "description"];
const LIST_PATHS = ["tags", "dependsOn"];

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Tells if `after` has a form that the Story write can take for the path. */
function hasWritableForm(change: FieldChange): boolean {
  if (TEXT_PATHS.includes(change.path)) {
    return typeof change.after === "string";
  }

  if (LIST_PATHS.includes(change.path)) {
    return isTextList(change.after);
  }

  return change.path.startsWith(FIELD_PREFIX);
}

/** The compare-and-set decision for one change on the Story. */
function decide(story: Story, change: FieldChange): Decision {
  const current = storyValue(story, change.path);

  if (!current.found) {
    return { change, action: "conflict", current: undefined, reason: `Unknown path ${change.path}` };
  }

  const action = compareChange(current.value, change);

  if (action === "write" && !hasWritableForm(change)) {
    return { change, action: "conflict", current: current.value, reason: "The new value has a bad form" };
  }

  return { change, action, current: current.value, reason: "The value on the main machine is different" };
}

/** The Story write for the changes to write. */
function updateInput(id: string, changes: readonly FieldChange[]): UpdateStoryInput {
  const fieldChanges = changes.filter((change) => change.path.startsWith(FIELD_PREFIX));
  const named = Object.fromEntries(
    changes.filter((change) => !change.path.startsWith(FIELD_PREFIX)).map((change) => [change.path, change.after]),
  );
  const fields = Object.fromEntries(
    fieldChanges.map((change) => [change.path.slice(FIELD_PREFIX.length), change.after]),
  );

  return { ...named, id, ...(fieldChanges.length > 0 ? { fields } : {}) };
}

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
  const found = await findStory(env, entry.storyId);

  if (!found.story) {
    const reason = found.problem;

    return entry.changes.map((change) =>
      toConflict(env, entry, { change, action: "conflict", current: undefined, reason }),
    );
  }

  const { story } = found;
  const decisions = entry.changes.map((change) => decide(story, change));
  const refused = await writeChanges(
    env,
    story,
    decisions.filter((decision) => decision.action === "write"),
  );

  return [...decisions.filter((decision) => decision.action === "conflict"), ...refused].map((decision) =>
    toConflict(env, entry, decision),
  );
}
