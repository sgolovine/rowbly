import { canonicalStoryId } from "../spec-files/spec-files.js";
import type { Store } from "../store/store.js";
import { type DocRepair, type DoctorIssue, type DoctorRun, reportChange } from "./doctor-run.js";

/**
 * The repair of the `stories` list of one spec. The link check walks `source` by index, as the loop of the
 * earlier code did. When `aliased` is true, `data.stories` is the same list as `source`, so a removal in
 * place also changes the list that the walk reads. A filter or a map makes a new list and ends this link.
 */
export interface SpecRepair extends DocRepair {
  readonly source: readonly unknown[];
  readonly aliased: boolean;
  /** The canonical Story IDs that the walk accepted. */
  readonly kept: readonly string[];
}

/** The values that the spec check needs, apart from the repair. */
export interface SpecCheck {
  readonly projectKey: string;
  readonly storyIds: ReadonlySet<string>;
  readonly file: string;
}

function storyList(state: Readonly<SpecRepair>): unknown[] {
  return state.data.stories as unknown[];
}

function withoutLink(state: Readonly<SpecRepair>, value: unknown): Partial<SpecRepair> {
  return { data: { ...state.data, stories: storyList(state).filter((v) => v !== value) }, aliased: false };
}

/** Removes the last copy of the value in place. `lastIndexOf` can give -1, which removes the last entry. */
function withoutRepeat(state: Readonly<SpecRepair>, value: unknown): Partial<SpecRepair> {
  const list = storyList(state);
  const next = list.toSpliced(list.lastIndexOf(value), 1);

  return { data: { ...state.data, stories: next }, source: state.aliased ? next : state.source };
}

function withCorrectedLink(state: Readonly<SpecRepair>, value: unknown, id: string): Partial<SpecRepair> {
  const stories = storyList(state).map((v) => (v === value ? id : v));

  return { data: { ...state.data, stories }, aliased: false };
}

async function acceptLink(
  run: DoctorRun,
  check: SpecCheck,
  repair: Store<SpecRepair>,
  value: unknown,
  id: string,
): Promise<DoctorIssue[]> {
  repair.update((state) => ({ kept: [...state.kept, id] }));

  if (value === id) {
    return [];
  }

  return [
    await reportChange(
      run,
      repair,
      {
        severity: "error",
        message: `Story ID "${String(value)}" should be ${id}`,
        file: check.file,
        fix: "Correct it",
      },
      (state) => withCorrectedLink(state, value, id),
    ),
  ];
}

async function linkIssues(
  run: DoctorRun,
  check: SpecCheck,
  repair: Store<SpecRepair>,
  value: unknown,
): Promise<DoctorIssue[]> {
  const { file } = check;
  const id = canonicalStoryId(check.projectKey, value);

  if (id === undefined) {
    const message = `"${String(value)}" is not a Story ID of this project`;

    return [
      await reportChange(run, repair, { severity: "error", message, file, fix: "Remove it" }, (state) =>
        withoutLink(state, value),
      ),
    ];
  }

  if (!check.storyIds.has(id)) {
    const message = `Links to ${id}, which does not exist`;

    return [
      await reportChange(run, repair, { severity: "warning", message, file, fix: "Remove the link" }, (state) =>
        withoutLink(state, value),
      ),
    ];
  }

  if (repair.current.kept.includes(id)) {
    const message = `Links to ${id} more than one time`;

    return [
      await reportChange(run, repair, { severity: "warning", message, file, fix: "Remove the repeat" }, (state) =>
        withoutRepeat(state, value),
      ),
    ];
  }

  return acceptLink(run, check, repair, value, id);
}

/** Walks the links from `index`. It reads `source` again at each step, because a fix can change it. */
export async function walkLinks(
  run: DoctorRun,
  check: SpecCheck,
  repair: Store<SpecRepair>,
  index: number,
): Promise<DoctorIssue[]> {
  const { source } = repair.current;

  if (index >= source.length) {
    return [];
  }

  const issues = await linkIssues(run, check, repair, source[index]);

  return [...issues, ...(await walkLinks(run, check, repair, index + 1))];
}
