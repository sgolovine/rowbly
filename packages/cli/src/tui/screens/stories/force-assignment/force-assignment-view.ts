import type { Key } from "ink";
import type { FactoryStatus } from "../../../../services/factory/factory.js";
import type { KeyHint } from "../../../keymap.js";
import { queueEntry } from "../../factory/factory-status.js";

/** The key hint of the `Force assignment` Button. */
export const FORCE_ASSIGNMENT_HINT: KeyHint = { key: "ctrl+r", description: "force assignment" };

/** The rows of the `Force assignment` Button at the top of the Story view: a blank row and the Button. */
export const FORCE_ASSIGNMENT_ROWS = 2;

/**
 * True when the user can force the assignment of the Story: the factory is live, its queue has an entry for the Story,
 * and the Story has no pending or running Thread. A queue entry means that the Story is in a work Stage.
 */
export function canForceAssignment(status: FactoryStatus | undefined, storyId: string, activeThread: boolean): boolean {
  return !activeThread && queueEntry(status, storyId) !== undefined;
}

/** `ctrl+r`: forces the assignment of the Story. */
export function isForceAssignmentKey(input: string, key: Key): boolean {
  return key.ctrl && input === "r";
}

/** The hints of the Story view, with the hint of the `Force assignment` Button first when it shows. */
export function withForceAssignmentHint(hints: readonly KeyHint[], shown: boolean): readonly KeyHint[] {
  return shown ? [FORCE_ASSIGNMENT_HINT, ...hints] : hints;
}
