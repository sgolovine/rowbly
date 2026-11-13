import { readdir } from "node:fs/promises";
import { mapInOrder } from "../in-order/in-order.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { getThread } from "./thread-files.js";
import type { ThreadList, ThreadRecord, ThreadStatus } from "./thread-types.js";

interface ListFilter {
  story?: string;
  role?: ThreadRecord["role"];
  status?: ThreadStatus;
}

interface ReadOutcome {
  readonly thread?: ThreadRecord;
  readonly issue?: { file: string; message: string };
}

function readOutcome(file: string, ctx: ServiceContext): Promise<ReadOutcome> {
  return getThread(file.slice(0, -".json".length), ctx).then(
    (thread) => ({ thread }),
    (error: unknown) => ({
      issue: { file: `threads/${file}`, message: error instanceof Error ? error.message : "Thread unavailable" },
    }),
  );
}

/** Reads one file at a time, in name order. Parallel reads of many files could use all file handles. */
function readInOrder(files: readonly string[], ctx: ServiceContext): Promise<ReadOutcome[]> {
  return mapInOrder(files, (file) => readOutcome(file, ctx));
}

function matches(thread: ThreadRecord, input: ListFilter): boolean {
  return (
    (!input.story || thread.storyId === input.story) &&
    (!input.role || thread.role === input.role) &&
    (!input.status || thread.status === input.status)
  );
}

function listedFiles(dir: string): Promise<string[]> {
  return readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  });
}

/** Lists the Threads that match the filter, oldest first. A file that cannot be read gives an issue. */
export async function listThreads(input: ListFilter = {}, ctx: ServiceContext = {}): Promise<ThreadList> {
  const paths = await findProject(ctx);
  const dir = await runtimePath(paths, "threads");
  const files = await listedFiles(dir);

  const outcomes = await readInOrder(files.filter((file) => file.endsWith(".json")).toSorted(), ctx);
  const threads = outcomes.flatMap(({ thread }) => (thread && matches(thread, input) ? [thread] : []));
  const issues = outcomes.flatMap(({ issue }) => (issue ? [issue] : []));

  return {
    threads: threads.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    issues,
  };
}
