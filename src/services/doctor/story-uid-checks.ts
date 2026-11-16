import { randomUUID } from "node:crypto";
import type { Store } from "../store/store.js";
import { isStoryUid } from "../story-files/story-files.js";
import { type DocRepair, type DoctorIssue, type DoctorRun, noted, reportChange } from "./doctor-run.js";

/**
 * Each Story must have a `uid` that is a UUID. A missing `uid` has a fix that adds a new one. An invalid `uid` has no
 * fix, because a different value can be the identity of the Story in other records.
 */
export async function uidIssues(run: DoctorRun, repair: Store<DocRepair>, file: string): Promise<DoctorIssue[]> {
  const { uid } = repair.current.data;

  if (uid === undefined || uid === null) {
    return [
      await reportChange(
        run,
        repair,
        { severity: "warning", message: "Story has no uid", file, fix: "Add a new uid" },
        (state) => ({ data: { ...state.data, uid: randomUUID() } }),
      ),
    ];
  }

  if (!isStoryUid(uid)) {
    return [noted({ severity: "error", message: `uid "${String(uid)}" is not a UUID`, file })];
  }

  return [];
}
