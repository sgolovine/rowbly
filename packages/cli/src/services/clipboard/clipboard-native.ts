// The native PNG reader. It runs the clipboard binding in a child process, because the binding can crash or hang.
import { type ChildProcess, spawn } from "node:child_process";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Store } from "../store/store.js";
import { type ClipboardFailure, type ClipboardImage, MAX_BYTES, png } from "./clipboard-state.js";

type NativeResult = ClipboardImage | ClipboardFailure;

/** The progress of one native helper. Only the first result counts. */
interface NativeReadState {
  readonly chunks: readonly Buffer[];
  readonly length: number;
  readonly finished: boolean;
  readonly timer: NodeJS.Timeout | undefined;
}

interface NativeRead {
  readonly child: ChildProcess;
  readonly pipe: Readable;
  readonly resolve: (result: NativeResult) => void;
  readonly state: Store<NativeReadState>;
}

const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;

/** A binding that does not load stays unavailable for the life of the process. */
const nativeLoader = new Store<{ readonly failed: boolean }>({ failed: false });

// Synchronous native calls and the binding loader can crash or hang.
// Keep the child inline so both source execution and the packed bundle use the same program.
const NATIVE_READER = `
import { createWriteStream } from 'node:fs';
const send = (value) => new Promise((resolve) =>
  createWriteStream('', { fd: 3 }).end(JSON.stringify(value), resolve));
let clipboard;
try {
  clipboard = await import('@mariozechner/clipboard');
} catch {
  await send({ reason: 'unsupported', loadFailed: true });
  process.exit(0);
}
try {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    await send({ reason: 'no-display' });
  } else if (!clipboard.hasImage()) {
    await send({ reason: 'no-image' });
  } else {
    const base64 = await clipboard.getImageBase64();
    await send(typeof base64 === 'string' && base64.length > ${MAX_BASE64}
      ? { reason: 'too-large' } : { base64 });
  }
} catch {
  await send({ reason: 'no-display' });
}
process.exit(0);
`;

/** Gives the result of a parsed helper response. A load failure stops later native reads in this process. */
function responseResult(value: object): NativeResult {
  if ("loadFailed" in value && value.loadFailed === true) {
    nativeLoader.update(() => ({ failed: true }));
  }

  if ("reason" in value) {
    const reason = value.reason;

    if (reason === "unsupported" || reason === "no-display" || reason === "no-image" || reason === "too-large") {
      return { reason };
    }
  }

  if ("base64" in value && typeof value.base64 === "string") {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64) || value.base64.length % 4 === 1) {
      return { reason: "unsupported" };
    }

    return png(Buffer.from(value.base64, "base64"));
  }

  return { reason: "unsupported" };
}

function parseResponse(chunks: readonly Buffer[]): NativeResult {
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    if (!value || typeof value !== "object") {
      return { reason: "unsupported" };
    }

    return responseResult(value);
  } catch {
    // A crash or malformed response is an unavailable reader, never a parent failure.
    return { reason: "unsupported" };
  }
}

/** Gives the first result only. It stops the helper, because a native call can hang. */
function finish(read: NativeRead, result: NativeResult): void {
  if (read.state.current.finished) {
    return;
  }

  read.state.update(() => ({ finished: true }));
  clearTimeout(read.state.current.timer);
  read.pipe.destroy();
  read.child.kill("SIGKILL");
  read.resolve(result);
}

function receiveChunk(read: NativeRead, chunk: Buffer): void {
  const { length } = read.state.update((state) => ({ length: state.length + chunk.length }));

  if (length > MAX_BASE64 + 1024) {
    finish(read, { reason: "too-large" });
  } else {
    read.state.update((state) => ({ chunks: [...state.chunks, chunk] }));
  }
}

function closeNative(read: NativeRead, code: number | null): void {
  if (read.state.current.finished) {
    return;
  }

  if (code !== 0) {
    finish(read, { reason: "unsupported" });

    return;
  }

  finish(read, parseResponse(read.state.current.chunks));
}

function startNative(deadline: number, resolve: (result: NativeResult) => void): void {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", NATIVE_READER], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    stdio: ["ignore", "ignore", "ignore", "pipe"],
    // Do not inherit loaders or debugging flags into a short-lived native helper.
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const pipe = child.stdio[3] as Readable;
  const state = new Store<NativeReadState>({ chunks: [], length: 0, finished: false, timer: undefined });

  const read: NativeRead = { child, pipe, resolve, state };

  state.update(() => ({
    timer: setTimeout(() => finish(read, { reason: "timeout" }), Math.max(1, deadline - Date.now())),
  }));
  pipe.on("data", (chunk: Buffer) => receiveChunk(read, chunk));
  pipe.on("error", () => finish(read, { reason: "unsupported" }));
  child.on("error", () => finish(read, { reason: "unsupported" }));
  child.on("close", (code) => closeNative(read, code));
}

/** Reads a PNG image with the native binding in a short-lived child process. */
export function readNative(deadline: number): Promise<NativeResult> {
  if (nativeLoader.current.failed) {
    return Promise.resolve({ reason: "unsupported" });
  }

  return new Promise((resolve) => startNative(deadline, resolve));
}
