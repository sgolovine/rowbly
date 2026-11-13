import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { ensureRuntimeIgnores, missingRuntimeIgnores } from "../runtime-files/runtime-files.js";
import { listThreads, type ThreadRecord } from "../thread/thread.js";
import { type DoctorIssue, type DoctorRun, noted, rel, report } from "./doctor-run.js";

async function folderIssue(run: DoctorRun, dir: string): Promise<DoctorIssue[]> {
  if (await pathExists(dir)) {
    return [];
  }

  return [
    await report(run, { severity: "error", message: "Folder is missing", file: rel(run, dir), fix: "Create it" }, () =>
      mkdir(dir, { recursive: true }).then(() => undefined),
    ),
  ];
}

/** The stages and stories folders must exist. */
export async function folderIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const issues = await mapInOrder([run.paths.stagesDir, run.paths.storiesDir], (dir) => folderIssue(run, dir));

  return issues.flat();
}

/** The Project ignore file must have the factory runtime rules. */
export async function ignoreIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const missingIgnores = await missingRuntimeIgnores(run.paths);

  if (!missingIgnores.length) {
    return [];
  }

  return [
    await report(
      run,
      {
        severity: "warning",
        message: "Factory runtime ignore rules are missing",
        file: rel(run, run.paths.ignoreFile),
        fix: "Add the missing rules",
      },
      () => ensureRuntimeIgnores(run.paths),
    ),
  ];
}

/** Git must not track runtime files. A folder outside Git, or without Git, has no tracked files. */
export async function trackedRuntimeIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const tracked = await promisify(execFile)(
    "git",
    ["-C", run.paths.root, "ls-files", "-z", "--", ".rowbly/runtime", ".rowbly/state.json*"],
    { encoding: "utf8" },
  ).then(
    (result) => result.stdout.split("\0").filter(Boolean),
    () => [],
  );

  return tracked.map((file) => noted({ severity: "warning", message: "Factory runtime file is tracked by Git", file }));
}

async function threadStoryIssue(run: DoctorRun, thread: ThreadRecord): Promise<DoctorIssue[]> {
  if (!thread.storyId || (await pathExists(join(run.paths.storiesDir, `${thread.storyId}.md`)))) {
    return [];
  }

  return [
    noted({
      severity: "warning",
      message: `Thread ${thread.id} links to a Story that does not exist`,
      file: `.rowbly/runtime/threads/${thread.id}.json`,
    }),
  ];
}

/** Reports corrupt Thread files and Threads of Stories that do not exist. It repairs nothing. */
export async function threadIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const threads = await listThreads({}, run.ctx);

  const fileIssues = threads.issues.map((issue) =>
    noted({ severity: "warning", message: issue.message, file: `.rowbly/runtime/${issue.file}` }),
  );
  const storyIssues = await mapInOrder(threads.threads, (thread) => threadStoryIssue(run, thread));

  return [...fileIssues, ...storyIssues.flat()];
}
