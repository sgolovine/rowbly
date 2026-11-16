import { readFile, stat } from "node:fs/promises";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { checkRuntimeDir, type RuntimeDir, runtimeChild, runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { LOCAL_HOST, type ThreadRecord } from "./thread-types.js";
import { validateThread, validId } from "./thread-validate.js";

const MAX_METADATA_BYTES = 1024 * 1024;

const SESSIONS_PREFIX = "sessions/";

/** The checked `threads/` and `sessions/` folders of one read operation. */
export interface ThreadDirs {
  readonly threads: RuntimeDir;
  readonly sessions: RuntimeDir;
}

/** Checks the `threads/` and `sessions/` folders one time for one read operation. */
export async function checkThreadDirs(paths: ProjectPaths): Promise<ThreadDirs> {
  const threads = await checkRuntimeDir(paths, "threads");
  const sessions = await checkRuntimeDir(paths, "sessions");

  return { threads, sessions };
}

function assertValidId(id: string): void {
  if (!validId(id)) {
    throw new ValidationError("Invalid thread ID");
  }
}

function assertSessionReference(t: ThreadRecord, file: string): void {
  if (!file.startsWith(`${SESSIONS_PREFIX}${t.id}/`) || !file.endsWith(".jsonl")) {
    throw new ValidationError("Invalid thread session reference");
  }
}

/** Gives the runtime reference of the metadata file of a Thread, relative to the runtime folder. */
export function threadReference(id: string): string {
  assertValidId(id);

  return `threads/${id}.json`;
}

async function threadPath(id: string, ctx: ServiceContext): Promise<string> {
  return runtimePath(await findProject(ctx), threadReference(id));
}

/** Gives the checked absolute path of the metadata file of a Thread below the checked `threads/` folder. */
export function threadFileIn(id: string, dirs: ThreadDirs): Promise<string> {
  assertValidId(id);

  return runtimeChild(dirs.threads, `${id}.json`);
}

/** Checks that the session reference stays in the session folder of the Thread. */
async function checkSession(t: ThreadRecord, ctx: ServiceContext): Promise<void> {
  if (t.session.file === null) {
    return;
  }

  assertSessionReference(t, t.session.file);
  await runtimePath(await findProject(ctx), t.session.file);
}

/** Checks the session reference below the checked `sessions/` folder. */
export async function checkSessionIn(t: ThreadRecord, dirs: ThreadDirs): Promise<void> {
  if (t.session.file === null) {
    return;
  }

  assertSessionReference(t, t.session.file);
  await runtimeChild(dirs.sessions, t.session.file.slice(SESSIONS_PREFIX.length));
}

/**
 * Reads and validates a Thread file. The caller gives the size from its own `stat` before the read.
 * Give a failure to `readProblem`.
 */
export async function readThreadFile(
  id: string,
  file: string,
  size: number | bigint,
  dirs: ThreadDirs,
): Promise<ThreadRecord> {
  if (size > MAX_METADATA_BYTES) {
    throw new ValidationError("Thread metadata is too large");
  }

  const t = validateThread(JSON.parse(await readFile(file, "utf8")));

  if (t.id !== id) {
    throw new ValidationError("Thread ID does not match its file");
  }

  await checkSessionIn(t, dirs);

  return withHost(t);
}

/** Gives the Thread with its host. All readers get the default here, so that an old file reads as local. */
function withHost(t: ThreadRecord): ThreadRecord {
  return t.host === undefined ? { ...t, host: LOCAL_HOST } : t;
}

async function readThread(id: string, dirs: ThreadDirs): Promise<ThreadRecord> {
  const file = await threadFileIn(id, dirs);

  return readThreadFile(id, file, (await stat(file)).size, dirs);
}

/** Maps a read error of a Thread file to a service error. */
export function readProblem(id: string, error: unknown): never {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new NotFoundError(`Thread ${id} not found`);
  }

  if (error instanceof SyntaxError) {
    throw new ValidationError(`Invalid thread JSON: ${id}`);
  }

  throw error;
}

/** Reads one Thread with the folders that the caller checked for this operation. */
async function readThreadIn(id: string, dirs: ThreadDirs): Promise<ThreadRecord> {
  assertValidId(id);

  return readThread(id, dirs).catch((error: unknown) => readProblem(id, error));
}

/** Reads and validates the metadata of one Thread. */
export async function getThread(id: string, ctx: ServiceContext = {}): Promise<ThreadRecord> {
  assertValidId(id);

  return readThreadIn(id, await checkThreadDirs(await findProject(ctx)));
}

/** Validates the metadata of a Thread and writes it durably. Gives the Thread as a read gives it. */
export async function saveThread(t: ThreadRecord, ctx: ServiceContext): Promise<ThreadRecord> {
  validateThread(t);
  await checkSession(t, ctx);

  const text = `${JSON.stringify(t)}\n`;

  if (Buffer.byteLength(text) > MAX_METADATA_BYTES) {
    throw new ValidationError("Thread metadata is too large");
  }

  await writeFileAtomic(await threadPath(t.id, ctx), text, { mode: 0o600, durable: true });

  return withHost(t);
}
