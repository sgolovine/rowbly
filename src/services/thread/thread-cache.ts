import type { BigIntStats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { readProblem, readThreadFile, threadPath } from "./thread-files.js";
import type { ThreadRecord } from "./thread-types.js";

/** One valid Thread record and the identity of the file that gave it. */
interface CacheEntry {
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly thread: ThreadRecord;
}

interface CacheState {
  /** The key is the absolute path of the Thread file, so two Projects do not share entries. */
  readonly entries: ReadonlyMap<string, CacheEntry>;
}

/** The cache of this process. It has no TTL, because the file identity is the authority. */
const cache = new Store<CacheState>({ entries: new Map() });

function sameFile(entry: CacheEntry, info: BigIntStats): boolean {
  return entry.ino === info.ino && entry.size === info.size && entry.mtimeNs === info.mtimeNs;
}

function remember(file: string, info: BigIntStats, thread: ThreadRecord): ThreadRecord {
  const entry = { ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, thread };

  cache.update((state) => ({ entries: withEntry(state.entries, file, entry) }));

  return thread;
}

/** Removes the entry of a file that cannot be read or validated. Then it gives the service error. */
function forget(id: string, file: string, error: unknown): never {
  cache.update((state) => ({ entries: withoutEntry(state.entries, file) }));

  return readProblem(id, error);
}

/**
 * Gives the validated metadata of one Thread. It reads the file only when its `ino`, `size` or `mtimeNs`
 * changed since the last read. The `stat` comes before the read, so a change during the read gives a new
 * identity on the next call. An invalid file is never cached.
 */
export async function cachedThread(id: string, ctx: ServiceContext): Promise<ThreadRecord> {
  const file = await threadPath(id, ctx);
  const info = await stat(file, { bigint: true }).catch((error: unknown) => forget(id, file, error));
  const entry = cache.current.entries.get(file);

  if (entry && sameFile(entry, info)) {
    return entry.thread;
  }

  return readThreadFile(id, file, info.size, ctx).then(
    (thread) => remember(file, info, thread),
    (error: unknown) => forget(id, file, error),
  );
}

/** Removes the entries of `dir` whose files are not in `files`, the absolute paths of the directory listing. */
export function pruneThreadCache(dir: string, files: ReadonlySet<string>): void {
  cache.update((state) => ({
    entries: new Map([...state.entries].filter(([file]) => dirname(file) !== dir || files.has(file))),
  }));
}
