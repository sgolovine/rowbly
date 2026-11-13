import { relative } from "node:path";
import type { RowblyError } from "../errors/errors.js";
import type { Store } from "../store/store.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";

export interface DoctorIssue {
  /** An `error` breaks a rule; a `warning` is allowed but probably a mistake. */
  severity: "error" | "warning";
  message: string;
  /** Relative to the project root. */
  file: string;
  /** What `--fix` does about it, when it can do anything. */
  fix?: string;
  /** Whether this run fixed it. */
  fixed: boolean;
}

export type IssueInput = Omit<DoctorIssue, "fixed">;

/** The fixed environment of one doctor run. */
export interface DoctorRun {
  readonly paths: ProjectPaths;
  readonly fix: boolean;
  readonly ctx: ServiceContext;
}

/** The frontmatter of one Story or spec while the checks repair it. */
export interface DocRepair {
  readonly data: Readonly<Record<string, unknown>>;
  readonly changed: boolean;
}

/** The path relative to the project root, as the issues show it. */
export function rel(run: DoctorRun, path: string): string {
  return relative(run.paths.root, path);
}

/** An issue that has no fix. */
export function noted(issue: IssueInput): DoctorIssue {
  return { ...issue, fixed: false };
}

/** Records an issue; when fixing and a fix exists, runs it first. */
export async function report(
  run: DoctorRun,
  issue: IssueInput,
  apply?: () => void | Promise<void>,
): Promise<DoctorIssue> {
  const fixed = run.fix && apply !== undefined;

  if (fixed) {
    await apply();
  }

  return { ...issue, fixed };
}

function applyChange<T extends DocRepair>(repair: Store<T>, change: (state: Readonly<T>) => Partial<T>): void {
  repair.update((state) => ({ ...change(state), changed: true }) as Partial<T>);
}

/** Records an issue whose fix changes the frontmatter. The next check reads the changed frontmatter. */
export function reportChange<T extends DocRepair>(
  run: DoctorRun,
  repair: Store<T>,
  issue: IssueInput,
  change: (state: Readonly<T>) => Partial<T>,
): Promise<DoctorIssue> {
  return report(run, issue, () => applyChange(repair, change));
}

/** A copy of the frontmatter without `key`. */
export function withoutKey(data: Readonly<Record<string, unknown>>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([name]) => name !== key));
}

/** The issue for a file with frontmatter that cannot be parsed. */
export function frontmatterIssue(error: RowblyError, file: string): DoctorIssue {
  const reason = error.details.reason;

  return noted({ severity: "error", message: `Invalid frontmatter: ${reason ?? error.message}`, file });
}
