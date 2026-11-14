import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { type ThreadRecord, threadReference } from "../thread/thread.js";
import type { ConversationEnv } from "./conversation-state.js";

const MISSING = "missing";
const NO_SESSION = "none";

function statsSignature(stats: Stats): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function missingFile(error: NodeJS.ErrnoException): string {
  if (error.code === "ENOENT") {
    return MISSING;
  }

  throw error;
}

/** Gives the same fields as `isReplaced` of the session index, or `missing` when the file does not exist. */
async function fileSignature(env: ConversationEnv, reference: string): Promise<string> {
  const path = await runtimePath(env.paths, reference);

  return stat(path).then(statsSignature, missingFile);
}

/** Gives the signature of the Thread file. It does not read the file. */
export async function threadSignature(env: ConversationEnv): Promise<string> {
  return fileSignature(env, threadReference(env.threadId));
}

/** Gives the signature of the session file and the leaf of a Thread record. It does not read the file. */
export async function sessionSignature(env: ConversationEnv, thread: ThreadRecord | undefined): Promise<string> {
  const file = thread?.session.file;

  if (!file) {
    return NO_SESSION;
  }

  return `${file}|${thread.session.leafId ?? ""}|${await fileSignature(env, file)}`;
}

/** Joins the signatures of the Thread file and the session file. */
export function watchSignature(thread: string, session: string): string {
  return `${thread}\n${session}`;
}
