import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mapInOrder } from "../in-order/in-order.js";
import { listStoryRefs, matchStoryRef, recordRef, type StoryRef } from "../story/story.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { cachedThread, pruneThreadCache } from "./thread-cache.js";
import { checkThreadDirs, type ThreadDirs } from "./thread-files.js";
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

function readOutcome(file: string, dirs: ThreadDirs): Promise<ReadOutcome> {
  return cachedThread(file.slice(0, -".json".length), dirs).then(
    (thread) => ({ thread }),
    (error: unknown) => ({
      issue: { file: `threads/${file}`, message: error instanceof Error ? error.message : "Thread unavailable" },
    }),
  );
}

/** Reads one file at a time, in name order. Parallel reads of many files could use all file handles. */
function readInOrder(files: readonly string[], dirs: ThreadDirs): Promise<ReadOutcome[]> {
  return mapInOrder(files, (file) => readOutcome(file, dirs));
}

/** The ID and the `uid` of each Story, when the filter has a Story. Other filters read no Story. */
function storyRefsFor(input: ListFilter, ctx: ServiceContext): Promise<readonly StoryRef[]> {
  return input.story ? listStoryRefs(ctx) : Promise.resolve([]);
}

/**
 * Tells if the Thread belongs to the Story with the ID `story`, by the rule of `matchStoryRef`. A Thread that
 * matches no Story, for example of a deleted Story, matches by its Story ID.
 */
function isThreadOf(thread: ThreadRecord, story: string, refs: readonly StoryRef[]): boolean {
  if (!thread.storyId) {
    return false;
  }

  const found = matchStoryRef(refs, recordRef(thread.storyId, thread.storyUid));

  return (found?.id ?? thread.storyId) === story;
}

function matches(thread: ThreadRecord, input: ListFilter, refs: readonly StoryRef[]): boolean {
  return (
    (!input.story || isThreadOf(thread, input.story, refs)) &&
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

/**
 * Lists the Threads that match the filter, oldest first. A file that cannot be read gives an issue. A file
 * with no change since the last list is not read again. See `thread-cache.ts`.
 * It checks the shared runtime folders one time, and then only the path segments of each Thread.
 */
export async function listThreads(input: ListFilter = {}, ctx: ServiceContext = {}): Promise<ThreadList> {
  const dirs = await checkThreadDirs(await findProject(ctx));
  const dir = dirs.threads.path;
  const files = (await listedFiles(dir)).filter((file) => file.endsWith(".json")).toSorted();

  pruneThreadCache(dir, new Set(files.map((file) => join(dir, file))));

  const outcomes = await readInOrder(files, dirs);
  const refs = await storyRefsFor(input, ctx);
  const threads = outcomes.flatMap(({ thread }) => (thread && matches(thread, input, refs) ? [thread] : []));
  const issues = outcomes.flatMap(({ issue }) => (issue ? [issue] : []));

  return {
    threads: threads.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    issues,
  };
}
