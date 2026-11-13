import { readFile, stat } from "node:fs/promises";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import type { ThreadRecord } from "./thread-types.js";
import { validateThread, validId } from "./thread-validate.js";

const MAX_METADATA_BYTES = 1024 * 1024;

async function threadPath(id: string, ctx: ServiceContext): Promise<string> {
  if (!validId(id)) {
    throw new ValidationError("Invalid thread ID");
  }

  return runtimePath(await findProject(ctx), `threads/${id}.json`);
}

/** Checks that the session reference stays in the session folder of the Thread. */
async function checkSession(t: ThreadRecord, ctx: ServiceContext): Promise<void> {
  if (t.session.file === null) {
    return;
  }

  if (!t.session.file.startsWith(`sessions/${t.id}/`) || !t.session.file.endsWith(".jsonl")) {
    throw new ValidationError("Invalid thread session reference");
  }

  await runtimePath(await findProject(ctx), t.session.file);
}

async function readThread(id: string, file: string, ctx: ServiceContext): Promise<ThreadRecord> {
  if ((await stat(file)).size > MAX_METADATA_BYTES) {
    throw new ValidationError("Thread metadata is too large");
  }

  const t = validateThread(JSON.parse(await readFile(file, "utf8")));

  if (t.id !== id) {
    throw new ValidationError("Thread ID does not match its file");
  }

  await checkSession(t, ctx);

  return t;
}

function readProblem(id: string, error: unknown): never {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new NotFoundError(`Thread ${id} not found`);
  }

  if (error instanceof SyntaxError) {
    throw new ValidationError(`Invalid thread JSON: ${id}`);
  }

  throw error;
}

/** Reads and validates the metadata of one Thread. */
export async function getThread(id: string, ctx: ServiceContext = {}): Promise<ThreadRecord> {
  const file = await threadPath(id, ctx);

  return readThread(id, file, ctx).catch((error: unknown) => readProblem(id, error));
}

/** Validates the metadata of a Thread and writes it durably. */
export async function saveThread(t: ThreadRecord, ctx: ServiceContext): Promise<ThreadRecord> {
  validateThread(t);
  await checkSession(t, ctx);

  const text = `${JSON.stringify(t)}\n`;

  if (Buffer.byteLength(text) > MAX_METADATA_BYTES) {
    throw new ValidationError("Thread metadata is too large");
  }

  await writeFileAtomic(await threadPath(t.id, ctx), text, { mode: 0o600, durable: true });

  return t;
}
