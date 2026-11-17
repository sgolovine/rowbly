// The session mirror of each remote Thread: a byte-exact copy of the complete lines of the session file of the host,
// below the local runtime folder. Peek, `thread log` and `inspect_worker` read it as a local session file.

import { chmod, mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { isSessionFileOf } from "../host-agent/host-session-bytes.js";
import { MAX_SESSION_READ_BYTES, type SessionFrame } from "../host-agent/host-session-lines.js";
import { HostProtocolError } from "../host-transport/host-errors.js";
import { checkRuntimeDir, runtimeChild } from "../runtime-files/runtime-files.js";
import { withEntry, withoutEntry } from "../store/store.js";
import type { HostConnection, RemoteEnv, RemoteRun } from "./remote-types.js";

const SESSIONS_PREFIX = "sessions/";

/** The output limit of one `session-bytes` call. The host gives at most `MAX_SESSION_READ_BYTES`. */
const SESSION_BYTES_LIMIT = MAX_SESSION_READ_BYTES + 65_536;

/** What the mirror does with one frame: skip it, append the bytes after the mirror end, or read the gap first. */
export type FrameStep =
  | { readonly kind: "skip" }
  | { readonly kind: "append"; readonly bytes: Buffer }
  | { readonly kind: "catch-up" };

/** The place of the missing bytes on the host and in the mirror. */
interface CatchUp {
  readonly connection: HostConnection;
  readonly threadId: string;
  readonly file: string;
  readonly path: string;
}

/** Gives the bytes of the lines of a frame: each line as UTF-8, with a newline. */
export function frameBytes(frame: SessionFrame): Buffer {
  return Buffer.from(frame.lines.map((line) => `${line}\n`).join(""), "utf8");
}

/**
 * Gives the step of one frame against the mirror size. A frame that starts after the mirror end, a gap frame of a long
 * line, or a frame whose bytes do not agree with its range needs the bytes of the host.
 */
export function frameStep(size: number, frame: SessionFrame): FrameStep {
  if (frame.end <= size) {
    return { kind: "skip" };
  }

  const bytes = frameBytes(frame);

  if (frame.offset > size || frame.lines.length === 0 || bytes.length !== frame.end - frame.offset) {
    return { kind: "catch-up" };
  }

  return { kind: "append", bytes: bytes.subarray(size - frame.offset) };
}

/** True when the value is a `session` frame with a session file of its Thread and a valid byte range. */
export function isSessionFrame(value: unknown): value is SessionFrame {
  const frame = (value ?? {}) as Partial<Record<keyof SessionFrame, unknown>>;
  const { threadId, offset, end, lines } = frame;

  return (
    frame.type === "session" &&
    typeof threadId === "string" &&
    isSessionFileOf(threadId, frame.file) &&
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(end) &&
    (offset as number) >= 0 &&
    (end as number) > (offset as number) &&
    Array.isArray(lines) &&
    lines.every((line) => typeof line === "string")
  );
}

/** Gives the session file of the run: the file of its end frame, else the last session that the manager got. */
export function runSessionFile(run: RemoteRun): string | undefined {
  const { ended, sent } = run.store.current;
  const session = ended?.session ?? (sent.session ? (JSON.parse(sent.session) as { file?: unknown }) : undefined);

  return typeof session?.file === "string" ? session.file : undefined;
}

/** Gives the mirror path of the session file, and creates its folders with mode 0700. */
async function mirrorPath(env: RemoteEnv, file: string): Promise<string> {
  const sessions = await checkRuntimeDir(env.input.paths, "sessions");
  const path = await runtimeChild(sessions, file.slice(SESSIONS_PREFIX.length));

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);

  return path;
}

/** Gives the size of the mirror file, or 0 when it does not exist. */
async function mirrorSize(path: string): Promise<number> {
  return stat(path).then(
    (info) => info.size,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return 0;
      }

      throw error;
    },
  );
}

/** Appends the bytes to the mirror file. A new file gets mode 0600. */
async function appendBytes(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "a", 0o600);

  try {
    await handle.write(bytes);
  } finally {
    await handle.close();
  }
}

/** Reads one window of the session file of the host from the offset. */
async function readHostBytes(env: RemoteEnv, catchUp: CatchUp, offset: number): Promise<Buffer> {
  const { connection, threadId, file } = catchUp;
  const command = [connection.rowbly, "host", "session-bytes", env.input.projectId];
  const result = await connection.transport.bytes(command, { threadId, file, offset }, { limit: SESSION_BYTES_LIMIT });

  if (result.exitCode !== 0) {
    throw new HostProtocolError(
      `The host command \`rowbly host session-bytes\` failed with exit code ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }

  return result.bytes;
}

/** Appends the bytes of the host from the offset, one window at a time, until the host has no more complete lines. */
async function copyFrom(env: RemoteEnv, catchUp: CatchUp, offset: number): Promise<void> {
  const bytes = await readHostBytes(env, catchUp, offset);

  if (bytes.length === 0) {
    return;
  }

  await appendBytes(catchUp.path, bytes);
  await copyFrom(env, catchUp, offset + bytes.length);
}

/** Reads the bytes after the mirror end from the host. A failure throws, and the mirror keeps the complete windows. */
async function fillMirror(env: RemoteEnv, host: string, threadId: string, file: string): Promise<string> {
  const path = await mirrorPath(env, file);
  const connection = await env.input.connect(host);

  await copyFrom(env, { connection, threadId, file, path }, await mirrorSize(path));

  return path;
}

/**
 * Applies one frame. After a gap, the mirror reads the missing bytes first. When that read fails, the frame is
 * dropped, so that the mirror never has a gap. A later catch-up gets the bytes.
 */
async function applyFrame(env: RemoteEnv, host: string, frame: SessionFrame): Promise<void> {
  const path = await mirrorPath(env, frame.file);
  const step = frameStep(await mirrorSize(path), frame);

  if (step.kind === "catch-up") {
    await fillMirror(env, host, frame.threadId, frame.file);

    const next = frameStep(await mirrorSize(path), frame);

    if (next.kind === "append") {
      await appendBytes(path, next.bytes);
    }

    return;
  }

  if (step.kind === "append") {
    await appendBytes(path, step.bytes);
  }
}

/** Runs a write of the mirror of the Thread after its earlier writes, so that two writes never run at the same time. */
function withMirror<T>(env: RemoteEnv, threadId: string, action: () => Promise<T>): Promise<T> {
  const next = (env.state.current.mirrors.get(threadId) ?? Promise.resolve()).then(action);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );

  env.state.update((state) => ({ mirrors: withEntry(state.mirrors, threadId, settled) }));

  return next;
}

/** Adds the lines of a `session` frame of the host to the mirror of its Thread. A failure drops the frame. */
export function takeSessionFrame(env: RemoteEnv, host: string, frame: SessionFrame): Promise<void> {
  return withMirror(env, frame.threadId, () => applyFrame(env, host, frame)).catch(() => undefined);
}

/** Reads the lines that the mirror of the Thread does not have from the host. Gives false when the read failed. */
export function catchUpSession(env: RemoteEnv, host: string, threadId: string, file: string): Promise<boolean> {
  return withMirror(env, threadId, () => fillMirror(env, host, threadId, file)).then(
    () => true,
    () => false,
  );
}

/** Reads the missing lines of the session of the run, when the run has a session. A failure does not throw. */
export async function catchUpRun(env: RemoteEnv, run: RemoteRun): Promise<void> {
  const file = runSessionFile(run);

  if (file && isSessionFileOf(run.threadId, file)) {
    await catchUpSession(env, run.host, run.threadId, file);
  }
}

/** Removes the write chain of the Thread after its last write. A new run of the Thread starts a new chain. */
export async function dropMirror(env: RemoteEnv, threadId: string): Promise<void> {
  const chain = env.state.current.mirrors.get(threadId);

  await chain;

  env.state.update((state) => ({
    mirrors: state.mirrors.get(threadId) === chain ? withoutEntry(state.mirrors, threadId) : state.mirrors,
  }));
}
