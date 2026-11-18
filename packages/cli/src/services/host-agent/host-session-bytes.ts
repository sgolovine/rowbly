// The read of the session bytes of one Thread for `rowbly host session-bytes`. The main machine fills a gap of its
// session mirror with these bytes.

import { open } from "node:fs/promises";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import type { HostAgentPaths } from "./host-agent-paths.js";
import { validateThreadId } from "./host-agent-paths.js";
import { MAX_SESSION_READ_BYTES, sessionPath } from "./host-session-lines.js";

const NEWLINE = 0x0a;

/** The input of `host session-bytes`: the Thread, its session file and the byte offset of the first byte. */
export interface SessionBytesInput {
  readonly threadId: string;
  readonly file: string;
  readonly offset: number;
}

/** True when the file is a session file of the Thread: `sessions/<thread-id>/<name>.jsonl`, with no `..` part. */
export function isSessionFileOf(threadId: string, file: unknown): file is string {
  return (
    typeof file === "string" &&
    file.startsWith(`sessions/${threadId}/`) &&
    file.endsWith(".jsonl") &&
    !file.split(/[\\/]/).includes("..")
  );
}

/** Gives the checked input, or throws a ValidationError. */
export function parseSessionBytesInput(value: unknown): SessionBytesInput {
  const input = (value ?? {}) as Partial<Record<keyof SessionBytesInput, unknown>>;
  const threadId = validateThreadId(input.threadId);
  const { file, offset } = input;

  if (!isSessionFileOf(threadId, file)) {
    throw new ValidationError(`The file must be a session file below sessions/${threadId}/`, { details: { file } });
  }

  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new ValidationError("The offset must be an integer that is not negative", { details: { offset } });
  }

  return { threadId, file, offset };
}

/**
 * Gives the bytes of the window that the main machine can append: the bytes up to the last newline. A window without
 * a newline gives all its bytes when the file continues after it, because then the window is a part of a long line.
 * At the end of the file, a part line waits for its newline.
 */
export function completeBytes(window: Buffer, atEnd: boolean): Buffer {
  const last = window.lastIndexOf(NEWLINE);

  if (last >= 0) {
    return window.subarray(0, last + 1);
  }

  return atEnd ? Buffer.alloc(0) : window;
}

/** Reads a window of at most `MAX_SESSION_READ_BYTES` from the offset. */
async function readWindow(path: string, offset: number): Promise<Buffer> {
  const handle = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    throw error.code === "ENOENT" ? new NotFoundError("The session file does not exist") : error;
  });

  try {
    const { size } = await handle.stat();
    const length = Math.max(Math.min(size - offset, MAX_SESSION_READ_BYTES), 0);

    if (length === 0) {
      return Buffer.alloc(0);
    }

    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);

    return completeBytes(buffer.subarray(0, bytesRead), offset + bytesRead >= size);
  } finally {
    await handle.close();
  }
}

/** Gives the complete session lines of the Thread from the offset of the input, at most 4 MiB. */
export async function hostSessionBytes(paths: HostAgentPaths, value: unknown): Promise<Buffer> {
  const input = parseSessionBytesInput(value);
  const path = sessionPath(paths.runtime, input.file);

  if (!path) {
    throw new ValidationError("Invalid session file", { details: { file: input.file } });
  }

  return readWindow(path, input.offset);
}
