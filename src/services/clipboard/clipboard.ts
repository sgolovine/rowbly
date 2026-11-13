import { type ChildProcess, type ExecFileException, execFile, spawn } from "node:child_process";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ValidationError } from "../errors/errors.js";
import { Store } from "../store/store.js";

export type ClipboardImageResult =
  | { bytes: Uint8Array; type: "image/png" }
  | { reason: "unsupported" | "no-display" | "no-image" | "too-large" | "timeout" };

type Failure = Extract<ClipboardImageResult, { reason: string }>;

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
  readonly resolve: (result: ClipboardImageResult) => void;
  readonly state: Store<NativeReadState>;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function png(bytes: Buffer): ClipboardImageResult {
  if (bytes.length > MAX_BYTES) {
    return { reason: "too-large" };
  }

  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { reason: "unsupported" };
  }

  return { bytes, type: "image/png" };
}

/** Gives the result of a parsed helper response. A load failure stops later native reads in this process. */
function responseResult(value: object): ClipboardImageResult {
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

function parseResponse(chunks: readonly Buffer[]): ClipboardImageResult {
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
function finish(read: NativeRead, result: ClipboardImageResult): void {
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

function startNative(deadline: number, resolve: (result: ClipboardImageResult) => void): void {
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

function readNative(deadline: number): Promise<ClipboardImageResult> {
  return new Promise((resolve) => startNative(deadline, resolve));
}

function wlPasteResult(error: ExecFileException | null, stdout: Buffer, deadline: number): Buffer | Failure {
  if (!error) {
    return stdout;
  }

  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return { reason: "too-large" };
  }

  if (error.killed || Date.now() >= deadline) {
    return { reason: "timeout" };
  }

  return { reason: error.code === "ENOENT" ? "unsupported" : "no-display" };
}

function wlPaste(args: string[], deadline: number): Promise<Buffer | Failure> {
  const left = deadline - Date.now();

  if (left <= 0) {
    return Promise.resolve({ reason: "timeout" });
  }

  return new Promise((resolve) => {
    execFile(
      "wl-paste",
      args,
      { encoding: "buffer", timeout: left, killSignal: "SIGKILL", maxBuffer: MAX_BYTES },
      (error, stdout) => resolve(wlPasteResult(error, stdout, deadline)),
    );
  });
}

/** Reads PNG bytes without touching the Data Root or printing. All attempts share a three-second deadline. */
export async function readClipboardImage(): Promise<ClipboardImageResult> {
  const deadline = Date.now() + 3000;
  const native = nativeLoader.current.failed ? ({ reason: "unsupported" } as const) : await readNative(deadline);

  if (!("reason" in native) || !["unsupported", "no-display"].includes(native.reason) || !process.env.WAYLAND_DISPLAY) {
    return native;
  }

  const types = await wlPaste(["--list-types"], deadline);

  if (!Buffer.isBuffer(types)) {
    return types;
  }

  if (!types.toString("utf8").split(/\r?\n/).includes("image/png")) {
    return { reason: "no-image" };
  }

  const bytes = await wlPaste(["--type", "image/png"], deadline);

  return Buffer.isBuffer(bytes) ? png(bytes) : bytes;
}

/** Gives the ValidationError for a clipboard failure, with a hint for a file attachment. */
export function clipboardFailure(
  reason: "unsupported" | "no-display" | "no-image" | "too-large" | "timeout",
  story?: string,
): ValidationError {
  const messages = {
    unsupported: "Clipboard image access is unsupported",
    "no-display": "No display is available for clipboard access",
    "no-image": "No PNG image on the clipboard",
    "too-large": "Clipboard image exceeds 10 MiB",
    timeout: "Clipboard image read timed out",
  };
  const fallback = story
    ? `Use \`rowbly add-attachment ${story} <file.png>\` to attach a file.`
    : "Save the Story first, then use its Attachments tab to add a PNG file.";

  return new ValidationError(messages[reason], {
    details: { reason },
    hint: `${process.env.WAYLAND_DISPLAY ? "Install wl-clipboard for Wayland. " : ""}${fallback}`,
  });
}
